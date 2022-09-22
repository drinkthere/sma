const { symbol } = require("minimist")(process.argv.slice(2));
const configs = require("./configs/config.json");
const currConfig = configs[symbol];

const baseToken = {
    name: currConfig.baseToken.name,
    onHand: currConfig.baseToken.onHand,
    reduce: currConfig.baseToken.reduce,
    amountPerBorrow: currConfig.baseToken.amountPerBorrow,
    free: 0,
    borrowed: 0,
    netAsset: 0,
};
const smaMargin = currConfig.smaMargin;
const difficulty = currConfig.difficulty;
const orderSize = currConfig.orderSize;

const calThreshold = () => {
    // 根据当前BaseToken的netAsset数量来决定buy或者sell的门槛, 范围在[smaMarginMin, smaMarginMax]之间
    const diff = baseToken.netAsset - baseToken.onHand;
    const diffRatio = diff / baseToken.onHand;

    let buyMargin = smaMargin;
    let sellMargin = smaMargin;
    if (diff >= 0) {
        // 0.5 用来减缓衰减的速度，后续可以抽到配置文件中
        sellMargin = Math.max(1, smaMargin - 0.5 * diffRatio * difficulty);
        buyMargin = smaMargin + diffRatio * difficulty;
    } else {
        sellMargin = smaMargin - diffRatio * difficulty;
        buyMargin = Math.max(1, smaMargin + 0.5 * diffRatio * difficulty);
    }

    return { buyMargin, sellMargin };
};

const main = async () => {
    console.log(
        `### netAsset增加时，1/buyMargin要不断变小，更难买，sellMargin也要不断变小，更易卖`
    );
    for (let i = 1; i <= 20; i++) {
        baseToken.netAsset = baseToken.onHand + orderSize * i;
        const { buyMargin, sellMargin } = calThreshold();
        console.log(`1/buyMargin: ${1 / buyMargin}, sellMargin: ${sellMargin}`);
    }
    console.log(
        `### netAsset减少时，1/buyMargin要不断变大，更易买，sellMargin也要不断变大，更难卖`
    );
    for (let i = 1; i <= 20; i++) {
        baseToken.netAsset = baseToken.onHand - orderSize * i;
        const { buyMargin, sellMargin } = calThreshold();
        console.log(`1/buyMargin: ${1 / buyMargin}, sellMargin: ${sellMargin}`);
    }
};
main();
