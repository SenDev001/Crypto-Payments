import dotenv from "dotenv";
import validate from "bitcoin-address-validation";
import fs from "fs";
require("dotenv").config();
const {client} = require("./database");
//Import environment variables
const result = dotenv.config();
if (result.error) throw result.error;

async function readTxsFromJson() {
  //Read all the transactions from the 2 specified JSON files altogether and save into txs array
  let txs = JSON.parse(
    fs.readFileSync("./transactions/transactions-1.json", "utf8")
  ).transactions.concat(
    JSON.parse(fs.readFileSync("./transactions/transactions-2.json", "utf8"))
      .transactions
  );
  return txs;
}

async function getOnlyDeposits(txs: any) {
  let deposits = txs.filter(
    (tx: { category: string }) => tx.category == "receive"
  );
  console.log("Deposits: " + deposits.length);
  return deposits;
}

async function processDeposits(txs: any) {
  // 1. Consider only deposit transactions
  let deposits = await getOnlyDeposits(txs);

  // 2. Ensure this list does not contain duplicates within
  let uniqueDeposits = await removeDuplicates(deposits);

  // 3. Determine deposit validity - adds validity-related property to the tx object
  let verifiedDeposits = await verifyDeposits(uniqueDeposits);

  // 5. Mark known/unkown recepient address
  let finalDeposits = await determineKnownTxs(verifiedDeposits);

  return finalDeposits;
}

async function determineKnownTxs(txs: any) {
  let markedDeposits: any = [];

  //Query customers DB for tx.account
  //Connect to MongoDB
  //   const MongoClient = Mongodb.MongoClient;
  //   var uri = process.env.MONGO_CONNECTION_STRING;
  //   const Client = new MongoClient(uri, { useUnifiedTopology: true }); // useUnifiedTopology removes a warning
  //   await Client.connect();
  try {
    /*for(var i =0; i < txs.length; i++){
            let tx = txs[i];
    
            let kResult = await isKnownDeposit(Client, tx); 
    
            tx["known"]  = kResult; //false for unreferenced deposits
    
            markedDeposits.push(tx);
        }*/

        

    markedDeposits = await Promise.all(
      txs.map(async (tx: any) => markKnownDeposit(tx)) //removed Client:any
    );
  } finally {
    // Client.close();
    console.log("Marked deposits: " + markedDeposits.length);
    return markedDeposits;
  }
}

async function markKnownDeposit(tx: any) {
  //removed Client:any
  tx["known"] = true;

  //   let customer = await Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.CUSTOMER_COLLECTION_NAME)
  //     .findOne({ address: tx.address });
  let customer = await client.query(
    "SELECT address FROM customer WHERE address = $1",
    [tx.address]
  );

  if (customer.rowCount === 0)
    //This address is not registered in our customers
    tx["known"] = false; //false for unreferenced deposits

  return tx;
}

async function removeDuplicates(deposits: any) {
  let uniqueDeposits = [];

  for (var i = 0; i < deposits.length - 1; i++) {
    let duplicatedTx = await isDuplicated(i, deposits);
    if (!duplicatedTx) {
      //If no duplicates were found in the rest of the array
      // Push deposit transaction to unique deposits array
      uniqueDeposits.push(deposits[i]);
    }
  }

  uniqueDeposits.push(deposits[deposits.length - 1]); //Insert last tx manually

  console.log("Unique Deposits: " + uniqueDeposits.length);

  return uniqueDeposits;
}

//Returns true if the tx at the given index is duplicated in the rest of deposits array.
async function isDuplicated(index: any, txs: any) {
  for (var i = index + 1; i < txs.length; i++) {
    //Check for similar txid
    if (txs[i].txid == txs[index].id) {
      return true;
    }
  }
  return false;
}

async function verifyDeposits(txs: any) {
  let verifiedDeposits = txs.map((tx: any) => verify(tx));
  return verifiedDeposits;
}

async function verify(tx: any) {
  // Start with assuming true validity
  let validity = {
    status: true,
    violations: [] as any,
  };

  //Perform validity checks:

  // 0. Ensure tx is correct
  /*  
    It is given that the txs are returned by rpc calls to bitcoind,
    but this is to ensure the files were not altered.
    E.g. No fake txs were injected in them / No incorrect details of transactions
    */
  // 0.a Transaction exists on the bitcoin network (txid comparison)
  //RPC call

  // 0.b Transaction details are accurate (txhash comparison) - Checking tx hash ensures all its details are accurate

  // 1. At least 6 confirmations.
  if (tx.confirmations < 6) {
    //{console.log('Less than 6 confirmations.'); return false;}
    validity.status = false;
    validity.violations.push("-Less than 6 confirmations.");
  }

  // 2. Recepient is a valid bitcoin address - this check should be made when sending the tx to minimize burning btc.
  if (validate(tx.address) == false) {
    //{console.log('Invalid recepient address'); return false;}
    validity.status = false;
    validity.violations.push("-Invalid recepient address.");
  }

  // 3. Block timestamp no more than 2 hours in the future

  // 4. Blockhash satisfies nBits proof of work

  // 5. No wallet conflicts
  if (tx.walletconflicts.length == 0) {
    // removed ! @note
    validity.status = false;
    validity.violations.push("-Wallet conflicts.");
  }

  tx["validityStatus"] = validity.status; //true or false for valid or invalid deposit respectively
  tx["validityViolations"] = validity.violations; //if deposit was invalid, this property says why.

  return tx;
}

async function saveDepositstoDB(txs: any) {
  //Query customers DB for tx.account
  //Connect to MongoDB
  // useUnifiedTopology removes a warning
  try {
    for (var i = 0; i < txs.length; i++) {
      let tx = txs[i];
      // Check if a duplicate tx is already saved in the db
      let duplicated = await isDuplicatedInDB(tx);

      if (duplicated) await deleteDuplicatesFromDB(tx.txid); //Delete older duplicate(the one in DB)

      //Add tx to DB
      await insertTxIntoDB(tx);
    }
  } finally {
  }
}

async function insertTxIntoDB(tx: any) {
  await client.query(
    "INSERT INTO transaction(txid,involvesWatchonly,account,address,category,amount,label,confirmations,blockhash,blockindex,blocktime,vout,walletconflicts,time,timereceived,bip125-replaceable)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    [
      tx.txid,
      tx.involvesWatchonly,
      tx.account,
      tx.address,
      tx.category,
      tx.amount,
      tx.label,
      tx.confirmations,
      tx.bloackhash,
      tx.blockindex,
      tx.blocktime,
      tx.vout,
      [tx.walletconflicts],
      tx.time,
      tx.timereceived,
      tx.bip125_replaceable,
    ]
  );

  //   Client.db(process.env.MONGO_DB_NAME)
  //   .collection(process.env.TX_COLLECTION_NAME)
  //   .insertOne(tx);
}

async function deleteDuplicatesFromDB(txid: any) {
  await client.query("DELETE FROM transaction WHERE txid = $1", [txid]);
  //   Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.TX_COLLECTION_NAME)
  //     .deleteMany({ txid: txid });
}

async function isDuplicatedInDB(tx: any) {
  let duplicate = true;

  //   let dtx = await Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.TX_COLLECTION_NAME)
  //     .findOne({ txid: tx.txid });

  let dtx2 = await client.query(
    "SELECT txid FROM transaction WHERE txid = $1",
    [tx.txid]
  );

  if (dtx2.rowCount === 0)
    //This tx is not registered in our tx DB from before
    duplicate = false;

  return duplicate;
}

async function findUnknownInfo() {
  //Find count and sum of deposits to unknown addresses
  //   let query = [
  //     {
  //       $match: { validityStatus: true, known: false },
  //     },
  //     {
  //       $group: {
  //         _id: null,
  //         count: {
  //           $sum: 1,
  //         },
  //         total: {
  //           $sum: "$amount",
  //         },
  //       },
  //     },
  //   ];

  //   let unknownResult = await Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.TX_COLLECTION_NAME)
  //     .aggregate(query)
  //     .toArray();

  let unknownResult = await client.query(
    "SELECT t.amount, c.address, SUM(t.amount) AS total, FROM transaction t JOIN customer c ON c.address != t.address  GROUP BY t.amount, c.address"
  );

  return unknownResult[0];
}

async function findMinMaxInfo() {
  //   let query = [
  //     {
  //       $match: { validityStatus: true },
  //     },
  //     {
  //       $group: {
  //         _id: null,
  //         smallest: {
  //           $min: "$amount",
  //         },
  //         largest: {
  //           $max: "$amount",
  //         },
  //       },
  //     },
  //   ];

  //   let resultMinMax = await Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.TX_COLLECTION_NAME)
  //     .aggregate(query)
  //     .toArray();

  let resultMinMax = await client.query(
    "SELECT MIN(amount) FROM transaction AS minAmount UNION SELECT MAX(amount) FROM transaction AS maxAmount"
  );
  return resultMinMax[0];
}

async function findKnownInfo() {
  //Find names, counts and sums of deposits to unknown addresses
  //   let query = [
  //     {
  //       $match: { validityStatus: true, known: true },
  //     },
  //     {
  //       $group: {
  //         _id: "$address",
  //         count: { $sum: 1 },
  //         total: { $sum: "$amount" },
  //       },
  //     },
  //     {
  //       $lookup: {
  //         from: process.env.CUSTOMER_COLLECTION_NAME,
  //         localField: "_id",
  //         foreignField: "address",
  //         as: "details",
  //       },
  //     },
  //     {
  //       $project: { _id: 0, "details._id": 0, "details.address": 0 },
  //     },
  //   ];

  //   let knownResult = await Client.db(process.env.MONGO_DB_NAME)
  //     .collection(process.env.TX_COLLECTION_NAME)
  //     .aggregate(query)
  //     .toArray();
  let knownResult = await client.query(
    "SELECT t.amount, c.address, SUM(t.amount) AS total, FROM transaction t JOIN customer c ON c.address = t.address  GROUP BY t.amount, c.address"
  );

  return knownResult;
}
async function getRequiredInfo() {
  let output = {
    knownInfo: [] as any /*  Sample value: 
                            [
                                { count: 3, total: 11.89, details: [ {name: "bla bla"} ] },
                                { count: 3, total: 89.72436723999999, details: [ {name: "kokoko"} ] },
                                { count: 6, total: 22.61287, details: [ {name: "jijiji"} ] }
                            ]
                        */,
    unknownCount: 0,
    unknownSum: 0,
    smallest: 0,
    largest: 0,
  };
  //Query customers DB for requiredInfo
  //Connect to MongoDB
  //   const MongoClient = Mongodb.MongoClient;
  //   var uri = process.env.MONGO_CONNECTION_STRING;
  //   const Client = new MongoClient(uri, { useUnifiedTopology: true }); // useUnifiedTopology removes a warning
  //   await Client.connect();
  try {
    /** Fill in the missing info:
     * let output = {
     *    knownInfo:[{count:xx, sum: x.xx, details:[{name:"lol"}]}],
     *    unknownCount: 0, unknownSum: 0,
     *    smallest: 0, largest: 0
     * };
     */
    //Find sum and count of known customers
    let knownResult = await findKnownInfo();
    output.knownInfo = knownResult;

    //Find sum and count of unreferenced deposits
    let unknownResult = await findUnknownInfo();
    output.unknownCount = unknownResult.count;
    output.unknownSum = unknownResult.total;

    //Find min and max tx amounts
    let resultMinMax = await findMinMaxInfo();
    output.smallest = resultMinMax.smallest;
    output.largest = resultMinMax.largest;
  } finally {
    return output;
  }
}

async function displayOutput() {
  let output = await getRequiredInfo();

  //Display to stdout
  for (var i = 0; i < output.knownInfo.length; i++) {
    console.log(
      "Deposited for " +
        output.knownInfo[i].details[0].name +
        ": count= " +
        output.knownInfo[i].count +
        " sum=" +
        output.knownInfo[i].total.toFixed(8)
    );
  }

  console.log(
    "Deposited without reference: count=" +
      output.unknownCount +
      " sum=" +
      output.unknownSum.toFixed(8)
  );

  console.log("Smallest valid deposit: " + output.smallest.toFixed(8));
  console.log("Largest valid deposit: " + output.largest.toFixed(8));
}

async function main() {
  try {
    let txs = await readTxsFromJson();

    let deposits = await processDeposits(txs);

    await saveDepositstoDB(deposits);

    await displayOutput();
  } catch (e) {
    throw e;
  }
}

//await main().catch(console.error);
main();
