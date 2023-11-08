import { DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { v4 as uuidv4 } from "uuid";
import {
  postsTable,
  postSchema,
  userSchema,
  usersTable,
  categorySchema,
  commentSchema,
  categoriesTable,
  commentsTable,
} from "../../db/schema";
import { DefaultLogger, LogWriter, eq } from "drizzle-orm";
import qs from "qs";

import {
  addToInMemoryCache,
  clearInMemoryCache,
  getFromInMemoryCache,
  isCacheValid,
  rehydrateCacheFromKVKeys,
  rehydrateCacheItemFromKVKey,
  setCacheStatusInvalid,
} from "./cache";
import {
  addCachePrefix,
  addToKvCache,
  addToKvKeys,
  clearKVCache,
  deleteKVById,
  getKVKeyLatest,
  getKVKeyLatestUrl,
  getRecordFromKvCache,
  saveKVData,
} from "./kv-data";
import {
  deleteD1ByTableAndId,
  getD1ByTableAndId,
  getD1DataByTable,
  insertD1Data,
  updateD1Data,
} from "./d1-data";
import { log } from "../util/logger";
import { triggerUrl } from "../api/api";
import { extraTableFromUrl } from "../util/helpers";

// export async function getRecordOld(d1, kv, id) {
//   const cacheKey = addCachePrefix(id);
//   const cacheResult = await getFromInMemoryCache(cacheKey);
//   console.log("cacheResult", cacheResult);
//   if (cacheResult && cacheResult.length) {
//     const cachedData = cacheResult[0].data;
//     console.log("**** cachedData ****", cachedData);

//     return cachedData;
//   }
//   const kvData = await getRecordFromKvCache(kv, id);

//   addToInMemoryCache(cacheKey, { data: kvData.data, source: "kv" });

//   return kvData;
// }

// export async function getRecord(
//   d1,
//   kv,
//   table,
//   params,
//   cacheKey,
//   source = "fastest"
// ) {
//   const cacheStatusValid = await isCacheValid();

//   if (cacheStatusValid) {
//     const cacheResult = await getFromInMemoryCache(cacheKey);
//     // console.log("cacheResult", cacheResult);
//     if (cacheResult && cacheResult.length && source == "fastest") {
//       const cachedData = cacheResult[0].data;
//       // console.log("**** cachedData ****", cachedData);

//       return cachedData;
//     }
//   }

//   const kvData = await getRecordFromKvCache(kv, cacheKey);
//   if (source == "kv" || kvData) {
//     console.log("**** getting kv cache ****", kvData);
//     return kvData;
//   }

//   const d1Data = await getD1ByTableAndId(d1, table, params.id);

//   addToInMemoryCache(cacheKey, { data: d1Data.data, source: "cache" });
//   addToKvCache(kv, cacheKey, { data: d1Data.data, source: "kv" });

//   // console.log("sql results ==>", results);

//   return d1Data;
// }
export async function getRecordsByUrl(ctx, url, source = "fastest") {
  console.log("getRecordsByUrl", url);
  const query = url.split("?")[1];
  var params = qs.parse(query);
  params.limit = params.limit ?? 1000;
  const table = extraTableFromUrl(url);
  console.log("getRecordsByUrl table", table);

  return getRecords(ctx, table, params, url, source, undefined);
}
export async function getRecords(
  ctx,
  table,
  params,
  cacheKey,
  source = "fastest",
  customDataFunction = undefined
) {
  cacheKey = addCachePrefix(cacheKey);
  log(ctx, { level: "verbose", message: "getRecords start", cacheKey });

  const cacheStatusValid = await isCacheValid();
  // console.log("getRecords cacheStatusValid", cacheStatusValid);
  log(ctx, {
    level: "verbose",
    message: `getRecords cacheStatusValid:${cacheStatusValid}`,
  });

  //return cache if available
  if (cacheStatusValid && source == "fastest") {
    log(ctx, {
      level: "verbose",
      message: "getRecords getFromInMemoryCache start",
    });
    const cacheResult = await getFromInMemoryCache(ctx, cacheKey);
    log(ctx, {
      level: "verbose",
      message: `getRecords getFromInMemoryCache end. cacheResult:${
        cacheResult && cacheResult.length
      }`,
    });

    // console.log("cacheResult", cacheResult);
    if (cacheResult && cacheResult.length && source == "fastest") {
      const cachedData = cacheResult[0].data;
      // console.log("**** cachedData ****", cachedData);

      return cachedData;
    }
  }

  var executionCtx;
  try {
    executionCtx = ctx.executionCtx;
  } catch (err) {}

  //return kv if available

  if (source == "fastest" || source == "kv") {
    log(ctx, {
      level: "verbose",
      message: "getRecords getRecordFromKvCache start",
    });
    const kvData = await getRecordFromKvCache(ctx.env.KVDATA, cacheKey);
    log(ctx, {
      level: "verbose",
      message: `getRecords getRecordFromKvCache end. kvData:${
        kvData && kvData.length
      }`,
    });

    if (kvData) {
      //we have the data in KV, but we should still cache it for the next matching request
      dataAddToInMemoryCache(
        ctx,
        executionCtx,
        cacheKey,
        kvData.data,
        kvData.total
      );

      return kvData;
    }
  }

  // cache and kv is not available, so get from d1
  var d1Data;
  let total = 0;

  if (customDataFunction) {
    log(ctx, {
      level: "verbose",
      message: "getRecords customDataFunction start",
    });
    d1Data = await customDataFunction();
    if (d1Data && d1Data[0]) {
      total = d1Data[0].total;
    } else if (Object.keys(d1Data).length) {
      total = 1;
    }
    log(ctx, {
      level: "verbose",
      message: "getRecords customDataFunction end",
    });
  } else {
    if (params && params.id) {
      log(ctx, {
        level: "verbose",
        message: "getRecords getD1ByTableAndId start",
      });
      d1Data = await getD1ByTableAndId(ctx.env.D1DATA, table, params.id);
      log(ctx, {
        level: "verbose",
        message: "getRecords getD1ByTableAndId end",
      });
      total = d1Data ? 1 : 0;
    } else {
      log(ctx, {
        level: "verbose",
        message: "getRecords getD1DataByTable start",
      });
      d1Data = await getD1DataByTable(ctx.env.D1DATA, table, params);
      log(ctx, {
        level: "verbose",
        message: "getRecords getD1DataByTable end",
      });
    }
  }

  if (d1Data.length) {
    total = d1Data[0].total;
  }

  log(ctx, {
    level: "verbose",
    message: "getRecords addToInMemoryCache start",
  });

  await dataAddToInMemoryCache(ctx, executionCtx, cacheKey, d1Data, total);

  log(ctx, {
    level: "verbose",
    message: "getRecords addToInMemoryCache end",
  });

  log(ctx, {
    level: "verbose",
    message: "getRecords addToKvCache start",
  });

  dataAddToKVCache(ctx, executionCtx, cacheKey, d1Data, total);

  log(ctx, {
    level: "verbose",
    message: "getRecords addToKvCache end",
  });

  const result = { data: d1Data, source: "d1", total };
  log(ctx, {
    level: "verbose",
    message: "getRecords end",
    cacheKey,
    data: result,
  });
  return result;
}

async function dataAddToKVCache(ctx, executionCtx, cacheKey, data, total) {
  addToKvCache(ctx, cacheKey, {
    data,
    source: "kv",
    total,
  });

  // if (executionCtx) {
  //   ctx.executionCtx.waitUntil(
  //     await addToKvCache(ctx, cacheKey, {
  //       data,
  //       source: "kv",
  //       total,
  //     })
  //   );
  // } else {
  //   await addToKvCache(ctx, cacheKey, {
  //     data,
  //     source: "kv",
  //     total,
  //   });
  // }
}

async function dataAddToInMemoryCache(
  ctx,
  executionCtx,
  cacheKey,
  data,
  total
) {
  addToInMemoryCache(ctx, cacheKey, { data, source: "cache", total });
  // HACK to support int testing
  // if (executionCtx) {
  //   ctx.executionCtx.waitUntil(
  //     addToInMemoryCache(ctx, cacheKey, { data, source: "cache", total })
  //   );
  // } else {
  //   return addToInMemoryCache(ctx, cacheKey, { data, source: "cache", total });
  // }
}

//insert
export async function insertRecord(d1, kv, data) {
  const content = data;
  const id = uuidv4();
  const timestamp = new Date().getTime();
  content.data.id = id;
  let error = "";

  // console.log("insertRecord", content);

  try {
    const result = await saveKVData(kv, id, content.data);
    // console.log('result KV', result);
    // return ctx.json(id, 201);
  } catch (error) {
    error = "error posting content" + error;
  } finally {
    //then also save the content to sqlite for filtering, sorting, etc
    try {
      const result = await insertD1Data(d1, kv, content.table, content.data);
      // console.log("insertD1Data --->", result);
      //expire cache
      await setCacheStatusInvalid();
      await clearKVCache(kv);

      return { code: 201, data: result };
    } catch (error) {
      error =
        "error posting content " +
        content.data.table +
        error +
        JSON.stringify(content.data, null, 2);
    }
  }
  return { code: 500, error };
}

//update
export async function updateRecord(ctx, d1, kv, data, cacheKey) {
  const timestamp = new Date().getTime();

  try {
    //TODO make more efficient with async
    //most important to make sure the data is updated in D1
    const record = await updateD1Data(d1, data.table, data);

    // cache
    const clearCache = await clearInMemoryCache();
    const kvUpdate = await addToInMemoryCache(ctx, cacheKey, record);

    //kv
    const clearKV = await clearKVCache(kv);
    const cacheUpdate = await addToKvCache(ctx, cacheKey, record);

    // const d1Result = d1Update;
    // const record = { ...data.data, id: data.id };

    //add last access url
    const latestUrl = await getKVKeyLatestUrl(kv);
    var recache;
    if (latestUrl) {
      recache = await getRecordsByUrl(ctx, latestUrl, "d1");
    }

    //repop all
    // rehydrateCacheFromKVKeys(ctx);

    return { code: 200, data: record };

    // return Promise.all([d1Update, clearKV, clearCache]).then(async (result) => {
    //   const d1Result = result[0];
    //   const record = { ...data.data, id: data.id };
    //   // const kvUpdate = addToInMemoryCache(ctx, cacheKey, record);

    //   // kv
    //   // const cacheUpdate = addToKvCache(ctx, kv, cacheKey, record);

    //   //add last access url
    //   const latestUrl = await getKVKeyLatestUrl(kv);
    //   const lastUrlUpdate = await getRecordsByUrl(ctx, latestUrl, "d1");

    //   return Promise.all([lastUrlUpdate]).then((values) => {
    //     console.log(values);
    //     return { code: 200, data: d1Update };
    //   });
    // });
  } catch (error) {
    console.log("error posting content", error);
    return { code: 500, message: error };
  } finally {
    //then also save the content to sqlite for filtering, sorting, etc
    try {
      //expire cache
      // await setCacheStatusInvalid();
      // await clearKVCache(kv);
      //getrecord to prime cache
      // getRecords(ctx, data.table, {id: data.id}, )
      // rehydrateCacheFromKVKeys(ctx);
      // return { code: 200, data: result };
    } catch (error) {
      console.log("error posting content", error);
    }
  }
}

// export async function updateRecord(ctx,d1, kv, data) {
//   const timestamp = new Date().getTime();

//   try {
//     const result = await saveKVData(kv, data, timestamp, data.id);
//   } catch (error) {
//     console.log("error posting content", error);
//     return { code: 500, message: error };
//   } finally {
//     //then also save the content to sqlite for filtering, sorting, etc
//     try {
//       const result = updateD1Data(d1, data.table, data);
//       //expire cache
//       await setCacheStatusInvalid();
//       await clearKVCache(kv);

//       rehydrateCacheFromKVKeys(ctx)
//       return { code: 200, data: result };
//     } catch (error) {
//       console.log("error posting content", error);
//     }
//   }
// }

//delete
export async function deleteRecord(d1, kv, data) {
  const timestamp = new Date().getTime();

  try {
    const kvResult = await deleteKVById(kv, data.id);
    const d1Result = await deleteD1ByTableAndId(d1, data.table, data.id);

    await setCacheStatusInvalid();
    await clearKVCache(kv);
  } catch (error) {
    console.log("error deleting content", error);
    return { code: 500, message: error };
  }
}
