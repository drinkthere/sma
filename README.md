# SMA 项目说明
这个项目是依赖 Average SMA 驱动交易的机器人。


## 第一步: 初始化配置文件
在根目录下创建.env 文件，并设置以下变量：
```powershell
BN_KEY=
BN_SECRET=
TELEGRAM_TOKEN=
TELEGRAM_CHANNEL_ID=
```
前两个是 Binance 的 APIKEY 和 APISECRET，后面是电报的 Token 和 ChatID

## 第二步: 安装依赖库
创建数据库和表
```powershell
npm install
```

## 第三步：初始化数据库表
创建数据库和表
```powershell
cd scripts;
node create_table;
```

## 第四步：资产配置
根据 configs/config.json 文件中的信息，在币安的杠杆账户种配置好对应的资产

## 第五步：启动
建议是用pm2来管理程序，如果服务器没有pm2，需要先安装 pm2.
```powershell
npm install --global pm2;
```
启动程序
```powershell
pm2 start app.js --name=sma -- --symbol=ETHBUSD
```

## 其他
**如何获取 Telegram 的 Channel ID**
1. 首先通过 telegram 的 botFather创建机器人，并获取到 token、
2.  将 token 写入.env 配置文件，执行 node tel.js
3.  创建 group 拉入刚才创建好的机器人，此时 console 会输出一个 ID(负整数)，这个 ID 就是 Channel ID
4.  把这个 ID 更新到.env 中

**如何查看数据库**
1. 首先确保服务器有安装 sqlite3，如果没有先安装
2. 链接数据库，查看订单信息
```powershell
cd dbs;
sqlite3 sma.db;
```
```sql
select * from tb_order;
```
