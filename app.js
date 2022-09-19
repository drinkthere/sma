// 运行参数，根据symbol获取对应的配置
const { symbol } = require("minimist")(process.argv.slice(2));
const configs = require("./configs/config.json");
const currConfig = configs[symbol];
const Binance = require("node-binance-api");
const { newInterval, wait } = require("./utils/run");
const uuidv1 = require("uuidv1");
const timer = require("performance-now");

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

const baseToken = {
    name: currConfig.baseToken.name,
    onHand: currConfig.baseToken.onHand,
    reduce: currConfig.baseToken.reduce,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};
const quoteToken = {
    name: currConfig.quoteToken.name,
    onHand: currConfig.quoteToken.onHand,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};

const bnb = {
    borrowed: 0,
    interest: 0,
};

const manageMarginAccountInterval = currConfig.manageMarginAccountInterval;
const smaLength = currConfig.smaLength;
const smaInterval = currConfig.smaInterval;
const smaMargin = currConfig.smaMargin;
const reduceMargin = currConfig.reduceMargin;
const orderSize = currConfig.orderSize;
const buyPauseDuration = currConfig.buyPauseDuration;
const sellPauseDuration = currConfig.sellPauseDuration;

let bid;
let ask;
let smaArr = [];
let smaAvg = 0;
let atRisk = true;
let ready = false;
let buyPause = false;
let sellPause = false;

const init = async () => {
    // 初始化时区
    process.env.TZ = "Asia/Hong_Kong";

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
                        bnb.borrowed = parseFloat(assetInfo.borrowed);
                        bnb.interest = parseFloat(assetInfo.interest);
                    }
                });
                console.log(baseToken, quoteToken, bnb);
            } catch (err) {
                console.log(err);
                // @todo 添加报警
                reject();
            }
            resolve();
        });
    });
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

        if (currMinute <= 58) {
            if (bnb.borrowed + bnb.interest > 0.1) {
                const repayBnbAmount = (bnb.borrowed + bnb.interest).toFixed(2);
                console.log(`Repay BNB ${repayBnbAmount}`);
                repay("BNB", repayBnbAmount);
            }
            console.log("borrow loop");
            if (baseToken.free < baseToken.onHand) {
                console.log(`Borrow ${baseToken.name} ${baseToken.onHand}`);
                borrow(baseToken.name, baseToken.onHand);
            }
            if (quoteToken.free < quoteToken.onHand) {
                console.log(`Borrow ${quoteToken.name} ${quoteToken.onHand}`);
                borrow(quoteToken.name, quoteToken.onHand);
            }
        }

        if (currMinute > 58) {
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
        }
    } catch (err) {
        console.error(err);
        //TODO: handle error
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
            false, // balance callback
            marginExecutionCallback
        );
    } catch (e) {
        console.log(e);
    }
};

const marginExecutionCallback = (event) => {
    if (event.e != "executionReport") {
        return;
    }
    if (event.S == "BUY" && event.X == "FILLED") {
        console.log(
            `buy order success, clientId=${event.c}, price=${event.p}, amount=${event.q}`
        );
        // @todo, 存入数据库，看下成单价与 bookticker 的滑点
    }
    if (event.S == "SELL" && event.X == "FILLED") {
        console.log(
            `sell order success, clientId=${event.c}, price=${event.p}, amount=${event.q}`
        );
        // @todo, 存入数据库，看下成单价与 bookticker 的滑点
    }
};

const wsListenSpotBookTicker = () => {
    try {
        // 监听现货价格
        binance.websockets.bookTickers(symbol, (bookticker) => {
            bid = parseFloat(bookticker.bestBid);
            ask = parseFloat(bookticker.bestAsk);
            // 价格更新超过1s，不交易，避免亏损
            atRisk = Date.now - bookticker.timestamp > 1000 ? false : true;
            trade();
        });
    } catch (e) {
        console.log(e);
    }
};

const trade = async () => {
    if (ask > smaAvg * smaMargin && !sellPause && !atRisk && ready) {
        sellPause = true;

        createOrder("SELL", "MARKET", orderSize);
        sellUnpause();
    } else if (
        ask > smaAvg * reduceMargin &&
        !sellPause &&
        !atRisk &&
        ready &&
        baseToken.netAsset > baseToken.reduce
    ) {
        sellPause = true;
        createOrder("SELL", "MARKET", orderSize);
        sellUnpause();
    }
    if (bid < smaAvg / smaMargin && !buyPause && !atRisk && ready) {
        buyPause = true;
        createOrder("BUY", "MARKET", orderSize);
        buyUnpause();
    } else if (
        bid < smaAvg / reduceMargin &&
        !buyPause &&
        !atRisk &&
        ready == true &&
        baseToken.netAsset < baseToken.reduce
    ) {
        buyPause = true;
        createOrder("BUY", "MARKET", size);
        buyUnpause();
    }
};

const buyUnpause = async () => {
    await wait(buyPauseDuration);
    buyPause = false;
};

const sellUnpause = async () => {
    await wait(sellPauseDuration);
    sellPause = false;
};

const createOrder = async (side, type, quantity) => {
    try {
        const start = timer();
        // 市价单，price=0
        const order = binance.marginOrder(side, symbol, quantity, 0, {
            type: "MARKET",
            isIsolated: "FALSE",
            newClientOrderId: uuidv1(),
        });
        const end = timer();
        // console.log(order)
        console.log(`createOrder time took ${end - start} ms`);
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
};
main();
