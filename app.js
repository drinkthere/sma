// 运行参数，根据symbol获取对应的配置
const { symbol } = require("minimist")(process.argv.slice(2));
const configs = require("./configs/config.json");
const currConfig = configs[symbol];
const Binance = require("node-binance-api");
const { newInterval, wait } = require("./utils/run");
const uuidv1 = require("uuidv1");
const timer = require("performance-now");
const TelegramBot = require("node-telegram-bot-api");

// 加载.env文件
const dotenv = require("dotenv");
dotenv.config();

// 初始化 binance client
const binance = new Binance().options({
    APIKEY: process.env.BN_KEY,
    APISECRET: process.env.BN_SECRET,
    family: 4,
    useServerTime: true,
    recvWindow: 10000,
});

// 电报相关
const teleBot = new TelegramBot(process.env.TELEGRAM_TOKEN);
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// 数据库相关
const dbFile = __dirname + "/dbs/sma.db";
let db;

const baseToken = {
    name: currConfig.baseToken.name,
    onHand: currConfig.baseToken.onHand,
    reduce: currConfig.baseToken.reduce,
    amountPerBorrow: currConfig.baseToken.amountPerBorrow,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};
const quoteToken = {
    name: currConfig.quoteToken.name,
    onHand: currConfig.quoteToken.onHand,
    amountPerBorrow: currConfig.quoteToken.amountPerBorrow,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};

const bnb = {
    onHand: currConfig.bnb.onHand,
    free: 0,
    borrowed: 0,
    interest: 0,
    netAsset: 0,
    repayThreshold: currConfig.bnb.repayThreshold,
    bid: 0,
};

const manageMarginAccountInterval = currConfig.manageMarginAccountInterval;
const smaLength = currConfig.smaLength;
const smaInterval = currConfig.smaInterval;
const smaMargin = currConfig.smaMargin;
const difficulty = currConfig.difficulty;
const k = currConfig.k;
const orderSize = currConfig.orderSize;
const buyPauseDuration = currConfig.buyPauseDuration;
const sellPauseDuration = currConfig.sellPauseDuration;
const borrowRepaySplitMinute = currConfig.borrowRepaySplitMinute;
const statInterval = currConfig.statInterval;

let bid;
let ask;
let smaArr = [];
let smaAvg = 0;
let atRisk = true;
let ready = false;
let buyPause = false;
let sellPause = false;
let marginLevel = 999;

const init = async () => {
    // 初始化时区
    process.env.TZ = "Asia/Hong_Kong";

    // 初始化数据库
    await initDb();

    // 初始化杠杆账户余额
    await getBalances();
};

const getBalances = async () => {
    return new Promise((resolve, reject) => {
        binance.mgAccount((error, resp) => {
            try {
                if (error) {
                    console.error(error);
                    // 添加报警
                    reject();
                }
                marginLevel = resp.marginLevel;
                resp.userAssets.map((assetInfo) => {
                    if (baseToken.name == assetInfo.asset) {
                        baseToken.free = parseFloat(assetInfo.free);
                        baseToken.borrowed = parseFloat(assetInfo.borrowed);
                        baseToken.netAsset = parseFloat(assetInfo.netAsset);
                    } else if (quoteToken.name == assetInfo.asset) {
                        quoteToken.free = parseFloat(assetInfo.free);
                        quoteToken.borrowed = parseFloat(assetInfo.borrowed);
                        quoteToken.netAsset = parseFloat(assetInfo.netAsset);
                    } else if ("BNB" == assetInfo.asset) {
                        bnb.free = parseFloat(assetInfo.borrowed);
                        bnb.borrowed = parseFloat(assetInfo.borrowed);
                        bnb.interest = parseFloat(assetInfo.interest);
                        bnb.netAsset = parseFloat(assetInfo.netAsset);
                    }
                });
                // console.log(baseToken, quoteToken, bnb);
            } catch (err) {
                console.log(err);
                teleBot.sendMessage(channelId, err.message);
                reject();
            }
            resolve();
        });
    });
};

const initDb = async () => {
    console.log("Start initializing database.");
    const sqlite3 = require("sqlite3").verbose();
    const { open } = require("sqlite");
    db = await open({
        filename: dbFile,
        driver: sqlite3.Database,
    });
    console.log("Finish initializing database.");
};

const marginAccountManagement = async () => {
    // 更新余额
    await getBalances();
    // 借款 || 还款（和利息）
    await borrowRepay();
};

const borrowRepay = async () => {
    try {
        const currMinute = new Date().getMinutes();

        if (currMinute <= borrowRepaySplitMinute) {
            console.log("borrow loop");
            // 增加一个限制，最多借一手, 2倍杠杆，
            if (
                baseToken.free < baseToken.onHand &&
                baseToken.borrowed < baseToken.onHand
            ) {
                console.log(
                    `Borrow ${baseToken.name} ${baseToken.amountPerBorrow}`
                );
                borrow(baseToken.name, baseToken.amountPerBorrow);
            }
            if (
                quoteToken.free < quoteToken.onHand &&
                quoteToken.borrowed < quoteToken.onHand
            ) {
                console.log(
                    `Borrow ${quoteToken.name} ${quoteToken.amountPerBorrow}`
                );
                borrow(quoteToken.name, quoteToken.amountPerBorrow);
            }
        }

        if (currMinute > borrowRepaySplitMinute) {
            console.log("repay loop");
            if (baseToken.free > baseToken.onHand && baseToken.borrowed > 0) {
                const repayAmount = Math.min(
                    baseToken.borrowed,
                    baseToken.onHand
                );
                console.log(`Repay ${baseToken.name} ${repayAmount}`);
                repay(baseToken.name, repayAmount);
            }
            if (
                quoteToken.free > quoteToken.onHand &&
                quoteToken.borrowed > 0
            ) {
                const repayAmount = Math.min(
                    quoteToken.borrowed,
                    quoteToken.onHand
                );
                console.log(`Repay ${quoteToken.name} ${repayAmount}`);
                repay(quoteToken.name, repayAmount);
            }

            // 用BNB支付可以节省5%的费用，需要在币安设置一下
            if (bnb.borrowed + bnb.interest > bnb.repayThreshold) {
                const repayBnbAmount = (bnb.borrowed + bnb.interest).toFixed(8);
                console.log(`Repay BNB ${repayBnbAmount}`);
                repay("BNB", repayBnbAmount);
            }
        }
    } catch (err) {
        console.error(err);
    }
};

const borrow = async (asset, amount) => {
    return new Promise((resolve, reject) => {
        try {
            binance.mgBorrow(asset, amount, (error, resp) => {
                if (error) return console.warn(error);
                resolve(resp);
            });
        } catch (err) {
            console.error(err);
            //TODO: handle error
            reject();
        }
    });
};

const repay = async (asset, amount) => {
    return new Promise((resolve, reject) => {
        try {
            binance.mgRepay(asset, amount, (error, resp) => {
                if (error) return console.warn(error);
                resolve(resp);
            });
        } catch (err) {
            console.error(err);
            //TODO: handle error
            reject();
        }
    });
};

const wsListenOrder = () => {
    try {
        // 监听订单信息
        binance.websockets.userMarginData(
            marginBalanceCallback,
            marginExecutionCallback
        );
    } catch (e) {
        console.log(e);
    }
};

const marginBalanceCallback = (data) => {};
const marginExecutionCallback = (event) => {
    if (event.e != "executionReport") {
        return;
    }
    // console.log(event);
    if (event.S == "BUY" && event.X == "FILLED") {
        const msg = `buy order success, clientId=${event.c}, price=${event.L}, amount=${event.q}`;
        console.log(msg);
        teleBot.sendMessage(channelId, msg);
        runSql(
            `INSERT INTO tb_order (symbol, client_id, direction, price, quantity) VALUES ('${symbol}', '${event.c}', 'BUY', ${event.L}, ${event.q})`
        );
    } else if (event.S == "SELL" && event.X == "FILLED") {
        const msg = `sell order success, clientId=${event.c}, price=${event.L}, amount=${event.q}`;
        console.log(msg);
        teleBot.sendMessage(channelId, msg);
        runSql(
            `INSERT INTO tb_order (symbol, client_id, direction, price, quantity) VALUES ('${symbol}', '${event.c}', 'SELL', ${event.L}, ${event.q})`
        );
    }
};

const runSql = async (sql) => {
    db.run(sql, (err) => {
        if (null != err) {
            console.log(err);
            process.exit();
        }
    });
};

const wsListenSpotBookTicker = () => {
    try {
        // 监听BNB现货价格
        binance.websockets.bookTickers(bnb.symbol, (bookticker) => {
            bnb.bid = parseFloat(bookticker.bestBid);
        });

        // 监听现货价格
        binance.websockets.bookTickers(symbol, (bookticker) => {
            bid = parseFloat(bookticker.bestBid);
            ask = parseFloat(bookticker.bestAsk);
            // 价格更新超过1s，不交易，避免亏损

            atRisk = Date.now() - bookticker.timestamp > 1000 ? true : false;
            trade();
        });
    } catch (e) {
        console.log(e);
    }
};

const trade = async () => {
    if (!ready || atRisk) {
        return;
    }
    const { buyMargin, sellMargin } = calThreshold();

    if (ask > smaAvg * sellMargin && !sellPause) {
        console.log(
            `===ask=${ask}, threshold=${
                smaAvg * sellMargin
            }, sellPause=${sellPause}`
        );
        sellPause = true;
        createOrder("SELL", "MARKET", orderSize, sellMargin);
        sellUnpause();
    }

    if (bid < smaAvg / buyMargin && !buyPause) {
        console.log(
            `===bid=${bid}, threshold=${
                smaAvg / buyMargin
            }, buyPause=${buyPause}`
        );
        buyPause = true;
        createOrder("BUY", "MARKET", orderSize, buyMargin);
        buyUnpause();
    }
};

const calThreshold = () => {
    // 详细变化见文档：https://silot.feishu.cn/sheets/shtcnc2r6HU6J2cmyowOZXdSZlg?from=from_copylink
    const diff = baseToken.netAsset - baseToken.onHand;
    const diffRatio = diff / baseToken.onHand;

    let buyMargin = smaMargin;
    let sellMargin = smaMargin;
    if (diff >= 0) {
        // k 用来减缓衰减的速度，后续可以抽到配置文件中
        sellMargin = Math.max(1, smaMargin - k * diffRatio * difficulty);
        buyMargin = smaMargin + (1 / k) * diffRatio * difficulty;
    } else {
        sellMargin = smaMargin - (1 / k) * diffRatio * difficulty;
        buyMargin = Math.max(1, smaMargin + k * diffRatio * difficulty);
    }

    return { buyMargin, sellMargin };
};

const buyUnpause = async () => {
    await wait(buyPauseDuration);
    buyPause = false;
};

const sellUnpause = async () => {
    await wait(sellPauseDuration);
    sellPause = false;
};

const createOrder = async (side, type, quantity, margin) => {
    try {
        const start = timer();
        // 市价单，price=0
        const order = binance.mgOrder(side, symbol, quantity, 0, {
            type: "MARKET",
            newClientOrderId: uuidv1(),
        });
        const end = timer();
        // console.log(order)
        console.log(
            `create side order margin is ${margin} and time took ${
                end - start
            } ms, `
        );
    } catch (e) {
        console.log(e);
    }
};

const calculateSma = async () => {
    if (bid != 0 && ask != 0) {
        smaArr.push((bid + ask) / 2);
    }

    if (smaArr.length > smaLength) {
        smaArr.shift();
    }
    if (smaArr.length >= smaLength) {
        ready = true;
        smaAvg = smaArr.reduce((a, b) => a + b) / smaArr.length;
    }
};

const stat = async () => {
    await getBalances();
    const baseTokenProfit = (baseToken.netAsset - baseToken.onHand) * bid;
    const quoteTokenProfit = quoteToken.netAsset - quoteToken.onHand;
    const bnbProfit = (bnb.netAsset - bnb.onHand) * bnb.bid;
    const totalProfit = baseTokenProfit + quoteTokenProfit + bnbProfit;
    const statistic = `Total Profit=${totalProfit}, ${baseToken.name}=${baseToken.netAsset}(f:${baseToken.free}|b:${baseToken.borrowed}), ${quoteToken.name}=${quoteToken.netAsset}(f:${quoteToken.free}|b:${quoteToken.borrowed}), BNB=${bnb.netAsset}(f:${bnb.free}|i:${bnb.interest}), ML=${marginLevel}`;
    console.log(statistic);
    teleBot.sendMessage(channelId, statistic);
};

const main = async () => {
    // @todo 增加最大出错次数，超过了停止程序
    await init();
    // 杠杆账户管理，借款、还款、还利息
    newInterval(marginAccountManagement, manageMarginAccountInterval);
    // 监听成交信息
    wsListenOrder();
    // 监听现货价格
    wsListenSpotBookTicker();
    // 定时计算 SMA
    newInterval(calculateSma, smaInterval);
    // 定时上报盈亏
    newInterval(stat, statInterval);
};
main();
