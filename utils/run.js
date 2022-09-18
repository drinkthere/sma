const newInterval = (func, millisecond) => {
    const inside = async () => {
        await func();
        setTimeout(inside, millisecond);
    }
    setTimeout(inside, millisecond);
}

function wait(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            // console.log("Done waiting");
            resolve(ms)
        }, ms)
    })
}

module.exports = {
    newInterval,
    wait
}
