const path = require("path");
const fs = require("fs");
const dbPath = path.resolve(__dirname, "..") + "/dbs";
const dbFile = dbPath + "/sma.db";
let db;

const runSql = async (sql) => {
    db.run(sql, (err) => {
        if (null != err) {
            console.log(err);
            process.exit();
        }
    });
};

const initDb = async () => {
    if (!fs.existsSync(dbPath)) {
        fs.mkdirSync(dbPath);
    }
    const sqlite3 = require("sqlite3").verbose();
    const { open } = require("sqlite");
    db = await open({
        filename: dbFile,
        driver: sqlite3.Database,
    });
};

const main = async () => {
    await initDb();

    // create table tb_order
    await runSql(
        "CREATE TABLE tb_order (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol VARCHAR(20), client_id VARCHAR(100), direction VARCHAR(10), price FLOAT, quantity FLOAT, create_time DATETIME DEFAULT CURRENT_TIMESTAMP, modify_time DATETIME DEFAULT CURRENT_TIMESTAMP)"
    );
    console.log("table tb_order hes been created");
};
main();
