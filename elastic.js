import dayjs from "dayjs";
import fetch from "node-fetch";

const blockAPI =
  "https://api.thegraph.com/subgraphs/name/kybernetwork/polygon-blocks";
const subgraphAPI =
  "https://api.thegraph.com/subgraphs/name/kybernetwork/kyberswap-elastic-matic";

function getTimestampsForChanges() {
  const utcCurrentTime = dayjs();
  const t1 = utcCurrentTime.subtract(1, "day").startOf("minute").unix();
  const t2 = utcCurrentTime.subtract(2, "day").startOf("minute").unix();
  const tWeek = utcCurrentTime.subtract(1, "week").startOf("minute").unix();
  return [t1, t2, tWeek];
}

const getBlocksFromTimestamps = async (timestamps) => {
  let queryString = "query blocks {";

  queryString += timestamps.map((timestamp) => {
    return `t${timestamp}:blocks(first: 200, orderBy: timestamp, orderDirection: desc, where: { timestamp_gt: ${timestamp}, timestamp_lt: ${
      timestamp + 600
    } }) {
      number
    }`;
  });
  queryString += "}";

  const fetchedData = await fetch(blockAPI, {
    method: "POST",
    body: JSON.stringify({
      query: queryString,
    }),
  }).then((res) => res.json());

  return Object.values(fetchedData.data).map((el) => el[0]);
};

const topPools = async () => {
  const {
    data: { pools },
  } = await fetch(subgraphAPI, {
    method: "POST",
    body: JSON.stringify({
      query: `
        query pools {
          pools(first: 200, orderBy: totalValueLockedUSD, orderDirection: desc) {
            id
          }
        }
      `,
    }),
  }).then((res) => res.json());

  return pools.map((p) => p.id);
};

const getPools = async (pools) => {
  let poolsString = `[`;
  pools.forEach((pool, index) => {
    poolsString += `"${pool}"`;
    if (index !== pools.length - 1) poolsString += ",";
  });
  poolsString += "]";

  const qs = `
  query pools {
    pools(first: 200, where: {id_in: ${poolsString}}, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      feeTier
      liquidity
      reinvestL
      sqrtPrice
      tick
      token0 {
        id
        symbol
        name
        decimals
        derivedETH
      }
      token1 {
        id
        symbol
        name
        decimals
        derivedETH
      }
      token0Price
      token1Price
      volumeUSD
      feesUSD
      txCount
      totalValueLockedToken0
      totalValueLockedToken1
      totalValueLockedUSD
      createdAtBlockNumber
    }
  }`;

  return fetch(subgraphAPI, {
    method: "POST",
    body: JSON.stringify({
      query: qs,
    }),
  }).then((res) => res.json());
};

const poolsHistorical = async (block, pools) => {
  let poolsString = `[`;
  pools.forEach((pool, index) => {
    poolsString += `"${pool}"`;
    if (index !== pools.length - 1) poolsString += ",";
  });
  poolsString += "]";
  const queryString = `
  query pools {
    pools(first: 200, where: {id_in: ${poolsString}}, block: {number: ${block}}, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      totalValueLockedUSD
      totalValueLockedETH
      volumeUSD
      feesUSD
      createdAtBlockNumber
    }
  }
  `;
  const res = await fetch(subgraphAPI, {
    method: "POST",
    body: JSON.stringify({
      query: queryString,
    }),
  }).then((res) => res.json());

  return res;
};

/**
 * gets the amoutn difference plus the % change in change itself (second order change)
 * @param {*} valueNow
 * @param {*} value24HoursAgo
 * @param {*} value48HoursAgo
 */
const get2DayPercentChange = (valueNow, value24HoursAgo, value48HoursAgo) => {
  // get volume info for both 24 hour periods
  let currentChange = parseFloat(valueNow) - parseFloat(value24HoursAgo);
  let previousChange =
    parseFloat(value24HoursAgo) - parseFloat(value48HoursAgo);

  const adjustedPercentChange =
    (parseFloat(currentChange - previousChange) / parseFloat(previousChange)) *
    100;

  if (isNaN(adjustedPercentChange) || !isFinite(adjustedPercentChange)) {
    return [currentChange, 0];
  }
  return [currentChange, adjustedPercentChange];
};

/**
 * get standard percent change between two values
 * @param {*} valueNow
 * @param {*} value24HoursAgo
 */
const getPercentChange = (valueNow, value24HoursAgo) => {
  const adjustedPercentChange =
    ((parseFloat(valueNow) - parseFloat(value24HoursAgo)) /
      parseFloat(value24HoursAgo)) *
    100;
  if (isNaN(adjustedPercentChange) || !isFinite(adjustedPercentChange)) {
    return 0;
  }
  return adjustedPercentChange;
};

function parseData(
  data,
  oneDayData,
  twoDayData,
  oneWeekData,
  oneDayBlock
) {
  // get volume changes
  const [oneDayVolumeUSD, volumeChangeUSD] = get2DayPercentChange(
    data?.volumeUSD,
    oneDayData?.volumeUSD ? oneDayData.volumeUSD : 0,
    twoDayData?.volumeUSD ? twoDayData.volumeUSD : 0
  );

  const [oneDayFeeUSD] = get2DayPercentChange(
    data?.feesUSD,
    oneDayData?.feesUSD ? oneDayData.feesUSD : 0,
    twoDayData?.feesUSD ? twoDayData.feesUSD : 0
  );

  const oneWeekVolumeUSD = parseFloat(
    oneWeekData ? data?.volumeUSD - oneWeekData?.volumeUSD : data.volumeUSD
  );

  // set volume properties
  data.oneDayVolumeUSD = parseFloat(oneDayVolumeUSD);
  data.oneWeekVolumeUSD = oneWeekVolumeUSD;
  data.oneDayFeeUSD = oneDayFeeUSD;
  data.volumeChangeUSD = volumeChangeUSD;

  // set liquiditry properties
  data.totalValueLockedChangeUSD = getPercentChange(
    data.totalValueLockedUSD,
    oneDayData?.totalValueLockedUSD
  );

  // format if pool hasnt existed for a day or a week
  if (!oneDayData && data && data.createdAtBlockNumber > oneDayBlock) {
    data.oneDayVolumeUSD = parseFloat(data.volumeUSD);
  }
  if (!oneDayData && data) {
    data.oneDayVolumeUSD = parseFloat(data.oneDayVolumeUSD);
  }
  if (!oneWeekData && data) {
    data.oneWeekVolumeUSD = parseFloat(data.oneWeekVolumeUSD);
  }

  data.name = data.token0.symbol + "/" + data.token1.symbol;
  data.tokens = [data.token0.symbol, data.token1.symbol];
  data.averageAPR =
    (parseFloat(data.oneDayFeeUSD) * 365 * 100) /
    parseFloat(data.totalValueLockedUSD);
  data.scAddress = data.id;
  data.tvl = data.totalValueLockedUSD;

  return data;
}


const fetchPools = async () => {
  const [t1, t2, tWeek] = getTimestampsForChanges();

  let [{ number: b1 }, { number: b2 }, { number: bWeek }] =
    await getBlocksFromTimestamps([t1, t2, tWeek]);

  const topPoolIds = await topPools();

  const [current, oneDayResult, twoDayResult, oneWeekResult] =
    await Promise.all([
      getPools(topPoolIds),
      ...[b1, b2, bWeek].map((block) => poolsHistorical(block, topPoolIds)),
    ]);

  let oneDayData = oneDayResult?.data?.pools.reduce((obj, cur) => {
    return { ...obj, [cur.id]: cur };
  }, {});

  let twoDayData = twoDayResult?.data?.pools.reduce((obj, cur) => {
    return { ...obj, [cur.id]: cur };
  }, {});

  let oneWeekData = oneWeekResult?.data?.pools.reduce((obj, cur) => {
    return { ...obj, [cur.id]: cur };
  }, {});

  let poolData =
    current &&
    current.data.pools.map((pool) => {
      let data = pool;
      let oneDayHistory = oneDayData?.[pool.id];

      let twoDayHistory = twoDayData?.[pool.id];

      let oneWeekHistory = oneWeekData?.[pool.id];

      data = parseData(
        data,
        oneDayHistory,
        twoDayHistory,
        oneWeekHistory,
        b1
      );
      return data;
    });

  console.log(poolData.slice(1,2));

  return poolData;
};

fetchPools();
