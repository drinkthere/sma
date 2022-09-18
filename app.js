// 运行参数，根据symbol获取对应的配置
const { symbol } = require("minimist")(process.argv.slice(2));
const configs = require("./config.json");
const currConfig = configs[symbol];
const Binance = require("node-binance-api");
const { newInterval, wait } = require("./utils/run");
const uuidv1 = require("uuidv1");

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
    orderSize: currConfig.baseToken.orderSize,
    reduce: currConfig.baseToken.reduce,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};
const quoteToken = {
    name: currConfig.quoteToken.name,
    onHand: currConfig.baseToken.onHand,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};

const bnb = {
    borrowed: 0,
    interest: 0,
};

let bid;
let ask;
let SMA = 0;
let atRisk = true;

const init = async () => {
    await getBalances();
};

const getBalances = async () => {
    return new Promise((resolve, reject) => {
        binance.mgAccount((error, balances) => {
            try {
                if (error) {
                    console.error(error);
                    // 添加报警
                    reject();
                }
                console.log(balances);
                /*
                for (var i = 0; i < resp.userAssets.length; i++) {
                    if (resp.userAssets[i].asset == CoinOne) {
                        CoinOneFree = parseFloat(resp.userAssets[i].free);
                        CoinOneBorrowed = parseFloat(
                            resp.userAssets[i].borrowed
                        );
                        CoinOneNetAsset = parseFloat(
                            resp.userAssets[i].netAsset
                        );
                    }
                    if (resp.userAssets[i].asset == CoinTwo) {
                        CoinTwoFree = parseFloat(resp.userAssets[i].free);
                        CoinTwoBorrowed = parseFloat(
                            resp.userAssets[i].borrowed
                        );
                        CoinTwoNetAsset = parseFloat(
                            resp.userAssets[i].netAsset
                        );
                    }
                    if (resp.userAssets[i].asset == "BNB") {
                        BNBBorrowed = parseFloat(resp.userAssets[i].borrowed);
                        BNBInterest = parseFloat(resp.userAssets[i].interest);
                    }
                }
                */
            } catch (err) {
                console.log(err);
                // 添加报警
                reject();
            }
            resolve();
        });
    });
};

const marginManagement = async () => {
    await getBalances();
    await borrowPay();
};

const borrowPay = async () => {
    try {
        const currMinute = new Date().getMinutes();

        if (currMinute <= 58) {
            if (BNBBorrowed + BNBInterest > 0.1) {
                console.log(
                    "Repay BNB",
                    (BNBBorrowed + BNBInterest).toFixed(2)
                );
                repay("BNB", (BNBBorrowed + BNBInterest).toFixed(2));
            }

            if (CoinOneFree < CoinOneOnHand) {
                console.log("Borrow CoinOne", CoinOneOnHand);
                borrow(CoinOne, CoinOneOnHand);
            }
            if (CoinTwoFree < CoinTwoOnHand) {
                console.log("Borrow CoinTwo", CoinTwoOnHand);
                borrow(CoinTwo, CoinTwoOnHand);
            }
        }

        if (currMinute > 58) {
            console.log("repay loop");
            if (CoinOneFree > CoinOneOnHand && CoinOneBorrowed > 0) {
                var repayAmount = CoinOneBorrowed;
                if (CoinOneBorrowed > CoinOneOnHand) {
                    repayAmount = CoinOneOnHand;
                }
                console.log("Repay CoinOne", repayAmount);
                repay(CoinOne, repayAmount);
            }
            if (CoinTwoFree > CoinTwoOnHand && CoinTwoBorrowed > 0) {
                var repayAmount = CoinTwoBorrowed;
                if (CoinTwoBorrowed > CoinTwoOnHand) {
                    repayAmount = CoinTwoOnHand;
                }
                console.log("Repay CoinTwo", repayAmount);
                repay(CoinTwo, repayAmount);
            }
        }
    } catch (err) {
        console.error(err);
        //TODO: handle error
    }
};

const main = async () => {
    await init();

    // 杠杆管理，借款、还款、还利息
    // newInterval(marginManagement, 30000);
};
