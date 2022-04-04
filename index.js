import dayjs from "dayjs";
import fetch from "node-fetch";

const blockAPI =
  "https://api.thegraph.com/subgraphs/name/dynamic-amm/dynamic-amm";
const subgraphAPI =
  "https://api.thegraph.com/subgraphs/name/dynamic-amm/dynamic-amm";

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
    return `t${timestamp}:blocks(first: 1, orderBy: timestamp, orderDirection: desc, where: { timestamp_gt: ${timestamp}, timestamp_lt: ${
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
          pools(first: 200, orderBy: trackedReserveETH, orderDirection: desc) {
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
    pools(first: 200, where: {id_in: ${poolsString}}, orderBy: reserveETH, orderDirection: desc) {
      id
      txCount
      token0 {
        id
        symbol
        name
        totalLiquidity
        derivedETH
      }
      token1 {
        id
        symbol
        name
        totalLiquidity
        derivedETH
      }
      amp
      reserve0
      reserve1
      vReserve0
      vReserve1
      reserveUSD
      totalSupply
      trackedReserveETH
      reserveETH
      volumeUSD
      feeUSD
      untrackedVolumeUSD
      untrackedFeeUSD
      token0Price
      token1Price
      token0PriceMin
      token0PriceMax
      token1PriceMin
      token1PriceMax
      createdAtTimestamp
    }
  }
  `;

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
    pools(first: 200, where: {id_in: ${poolsString}}, block: {number: ${block}}, orderBy: trackedReserveETH, orderDirection: desc) {
      id
      reserveUSD
      trackedReserveETH
      volumeUSD
      feeUSD
      untrackedVolumeUSD
      untrackedFeeUSD
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
  ethPrice,
  oneDayBlock
) {
  // get volume changes
  const [oneDayVolumeUSD, volumeChangeUSD] = get2DayPercentChange(
    data?.volumeUSD,
    oneDayData?.volumeUSD ? oneDayData.volumeUSD : 0,
    twoDayData?.volumeUSD ? twoDayData.volumeUSD : 0
  );

  const [oneDayFeeUSD] = get2DayPercentChange(
    data?.feeUSD,
    oneDayData?.feeUSD ? oneDayData.feeUSD : 0,
    twoDayData?.feeUSD ? twoDayData.feeUSD : 0
  );
  const [oneDayVolumeUntracked, volumeChangeUntracked] = get2DayPercentChange(
    data?.untrackedVolumeUSD,
    oneDayData?.untrackedVolumeUSD
      ? parseFloat(oneDayData?.untrackedVolumeUSD)
      : 0,
    twoDayData?.untrackedVolumeUSD ? twoDayData?.untrackedVolumeUSD : 0
  );
  const [oneDayFeeUntracked] = get2DayPercentChange(
    data?.untrackedFeeUSD,
    oneDayData?.untrackedFeeUSD ? parseFloat(oneDayData?.untrackedFeeUSD) : 0,
    twoDayData?.untrackedFeeUSD ? twoDayData?.untrackedFeeUSD : 0
  );
  const oneWeekVolumeUSD = parseFloat(
    oneWeekData ? data?.volumeUSD - oneWeekData?.volumeUSD : data.volumeUSD
  );

  // set volume properties
  data.oneDayVolumeUSD = parseFloat(oneDayVolumeUSD);
  data.oneWeekVolumeUSD = oneWeekVolumeUSD;
  data.oneDayFeeUSD = oneDayFeeUSD;
  data.oneDayFeeUntracked = oneDayFeeUntracked;
  data.volumeChangeUSD = volumeChangeUSD;
  data.oneDayVolumeUntracked = oneDayVolumeUntracked;
  data.volumeChangeUntracked = volumeChangeUntracked;

  // set liquiditry properties
  data.trackedReserveUSD = data.trackedReserveETH * ethPrice;
  data.liquidityChangeUSD = getPercentChange(
    data.reserveUSD,
    oneDayData?.reserveUSD
  );

  // format if pool hasnt existed for a day or a week
  if (!oneDayData && data && data.createdAtBlockNumber > oneDayBlock) {
    data.oneDayVolumeUSD = parseFloat(data.volumeUSD);
  }
  if (!oneDayData && data) {
    data.oneDayVolumeUSD = parseFloat(data.volumeUSD);
  }
  if (!oneWeekData && data) {
    data.oneWeekVolumeUSD = parseFloat(data.volumeUSD);
  }

  data.name = data.token0.symbol + "/" + data.token1.symbol;
  data.tokens = [data.token0.symbol, data.token1.symbol];
  data.baseAPY =
    ((data.oneDayFeeUSD || data.oneDayFeeUntracked) * 365 * 100) /
    (data.reserveUSD || data.trackedReserveUSD);
  data.scAddress = data.id;
  data.tvl = data.reserveUSD;

  return data;
}

/**
 * Gets the current price  of ETH, 24 hour price, and % change between them
 */
const getEthPrice = async () => {
  const utcCurrentTime = dayjs();
  const utcOneDayBack = utcCurrentTime
    .subtract(1, "day")
    .startOf("minute")
    .unix();

  let ethPrice = 0;
  let ethPriceOneDay = 0;
  let priceChangeETH = 0;

  try {
    let [{ number: oneDayBlock }] = await getBlocksFromTimestamps([
      utcOneDayBack,
    ]);
    let result = await fetch(subgraphAPI, {
      method: "POST",
      body: JSON.stringify({
        query: `   query bundles {
      bundles {
        id
        ethPrice
      }
    }
`,
      }),
    }).then((res) => res.json());

    let resultOneDay = await fetch(subgraphAPI, {
      method: "POST",
      body: JSON.stringify({
        query: `   query bundles {
      bundles(where: {block: ${oneDayBlock}}) {
        id
        ethPrice
      }
    }
`,
      }),
    }).then((res) => res.json());

    const currentPrice = result?.data?.bundles[0]?.ethPrice;
    const oneDayBackPrice = resultOneDay?.data?.bundles[0]?.ethPrice;
    priceChangeETH = getPercentChange(currentPrice, oneDayBackPrice);
    ethPrice = currentPrice || 0;
    ethPriceOneDay = oneDayBackPrice || currentPrice;
  } catch (e) {
    console.log(e);
  }

  return [ethPrice, ethPriceOneDay, priceChangeETH];
};

const fetchPools = async () => {
  const [ethPrice] = await getEthPrice();
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
        ethPrice,
        b1
      );
      return data;
    });

  console.log(poolData);

  return poolData;
};

fetchPools();
