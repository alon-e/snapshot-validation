const IOTA = require('iota.lib.js');
const {
    promisify
} = require('util');

var IF_address = "FFUIAREGAAAHNTPJRGRFCNCNOTKTKPWJEGUDWQHZVVO9MTAXZIDMXBMWJXTLUBHNFNKYCCTQUXOUYFKX9"

const fs = require('fs');
const request = require('request');

function doRequest(url) {
  return new Promise(function (resolve, reject) {
    request(url, function (error, res, body) {
      if (!error && res.statusCode == 200) {
        resolve(body);
      } else {
        reject(error);
      }
    });
  });
}

// construct iota.lib.js instance
var iotaNode = 'http://localhost:14265'
let iota = new IOTA({
    provider: iotaNode
});

const Aug_08_Url = "https://raw.githubusercontent.com/iotaledger/iri/c23298fb27bb48cdd166abae8a8792d2f975ff79/src/main/resources/Snapshot.txt"
const proposedSnapshotUrl = "https://ipfs.io/ipfs/QmeC5kYrUXQpcAF8ZQ7Vwsq6STP3xV13HpNgFn1XzbPrdU/m5_sn.txt"
const snapshotCasesUrl = "https://ipfs.io/ipfs/Qmeb4B5AEi5MWTreKPRtufBFRFWRVTpZkBpX6FeaXCAe3B"

const PfindTransactions = promisify(iota.api.findTransactions.bind(iota.api));
const PgetTransactionsObjects = promisify(iota.api.getTransactionsObjects.bind(iota.api));
const PgetBundle = promisify(iota.api.getBundle.bind(iota.api));

var validateBundle = async(bundleHash) => {
    let hashes = await PfindTransactions({
        bundles: [bundleHash]
    });
    let objects = await PgetTransactionsObjects(hashes);
    let tails = objects.filter(o => o.currentIndex == 0);
    if (!tails) {
      console.log("Warning: no transactions found for bundle:", bundleHash);
      return true;
    } else {
      //validate signatures
      let bundles = await PgetBundle(tails[0].hash)
      return (bundles != null)
    }
}
var validateSnapshot = async() => {
  console.log("# getting Aug 8th Snapshot...");

  //Curl snapshot
  var Aug_08_Data = await doRequest(Aug_08_Url);
  var Aug_08_Detail = Aug_08_Data
      .toString()
      .split("\n")
      .map(l => {
          let el = l.split(":");
          return {
              address: el[0],
              balance: parseInt(el[1])
          };
      })
      .filter(t => t.address.length > 0);
  var Aug_08_Balances = {};
  Aug_08_Detail.forEach(e => Aug_08_Balances[e.address] = e.balance);


  //proposed snapshot
  console.log("# getting proposed Snapshot...");
  var proposedSnapshotBody = await doRequest(proposedSnapshotUrl);
  var proposedSnapshot = proposedSnapshotBody
      .toString()
      .split("\n")
      .map(l => {
          let el = l.split(":");
          return {
              address: el[0],
              balance: parseInt(el[1])
          };
      })
      .filter(t => t.address.length > 0);
      var proposedSnapshotBalances = {};
      proposedSnapshot.forEach(e => proposedSnapshotBalances[e.address] = e.balance);

  //local snapshot IXI
  console.log("# getting local Snapshot (ixi) ...");
  var command = {
      'command': 'Snapshot.getState'
  }
  var options = {
      url: iotaNode,
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify(command))
      },
      json: command
  };
  let ixiData = await doRequest(options);
  const ixiBalances = ixiData.ixi.state;

  //read the latestStateWithCategory_pre file
  console.log("# getting Snapshot Cases ...");
  var snapshotCasesBody = await doRequest(snapshotCasesUrl)
  var snapshotCases = JSON.parse(snapshotCasesBody);

  //go over each KEY_REUSE
  var keyReuseCases = snapshotCases.filter(e => e.category === 'KEY_REUSE');



  //go over each CURL_USED + CURL_UNUSED
  var CurlSnapshotCases = snapshotCases.filter(e => (e.category === 'CURL_USED' ||e.category === 'CURL_UNUSED') );
  //check that they are in Aug08 snapshot
  console.log("checking Curl Snapshot Cases ... (", CurlSnapshotCases.length, ")");
  CurlSnapshotCases.forEach((entry) => {
    var existsInCurlSnapshot = Aug_08_Balances.hasOwnProperty(entry.address);
    if (!existsInCurlSnapshot) {
        console.log("FATAL ERROR: Address not in Curl snapshot: ", entry.address);
    }
  })

  //sum all values & compare to IF address
  var keyReuseValues = keyReuseCases.map((a) => a.balance)
  var keyReuseSum = keyReuseValues.reduce((a, b) => {return a + b;}, 0);

  var CurlSnapshotValues = CurlSnapshotCases.map((a) => a.balance)
  var CurlSnapshotSum = CurlSnapshotValues.reduce((a, b) => {return a + b;}, 0);

  var IF_sum = keyReuseSum + CurlSnapshotSum
  console.log("MOVED BALANCE CORRECT: ", parseInt(IF_sum) === parseInt(proposedSnapshotBalances[IF_address]), IF_sum, proposedSnapshotBalances[IF_address]);

  var rest = snapshotCases.filter(e => e.category === 'NONE');
  //check all the NONE addresses & compare to snapshot.ixi
  console.log("checking the rest ...");
  rest.forEach((entry) => {
    var sameBalanceIXI = parseInt(ixiBalances[entry.address]) === parseInt(entry.balance);
    if (!sameBalanceIXI) {
        console.log("FATAL ERROR: Balance incorrect for: ", entry.address);
        console.log("Balance (proposed snapshot cases vs. local): ", entry.balance, parseInt(ixiBalances[entry.address]))
    }
  });


    //move the 2 curl addresses
    rest.forEach((entry) => {
      //   4115709782263 on QGYKGMGSDAKRVRPJAMXDBYSREZIEASSZZKFRPRJDSNMMZBITTTZUQZYTONJVDBBACWYHOWRJHKEPYKRBS
      // newAddress=CLYICQNTDXMVOMRIMCAL9XGIACQIIAALZQCAHRATFLEPXQKIYFCSDNTYZWJAWHPCNAUWVKPZFEYQJGJT9
      if (entry.address === "QGYKGMGSDAKRVRPJAMXDBYSREZIEASSZZKFRPRJDSNMMZBITTTZUQZYTONJVDBBACWYHOWRJHKEPYKRBS") {
        entry.address =     "CLYICQNTDXMVOMRIMCAL9XGIACQIIAALZQCAHRATFLEPXQKIYFCSDNTYZWJAWHPCNAUWVKPZFEYQJGJT9";
      }

      // 30770000000 on KGUYGYFKSHCXPSJAMYBZKRM9EXGBL9ZKYXJITVRLQFYZKEFPXOCDVTLE9ODVAHNSUZNVSJADRHDMPWQRU
      // newAddress=FM9TXYBQMDBABOBGGDCSGWLCJIHSWRZSFLNJXUGZRJOFWKYAUBDNQBQBEA9KHHBIWXURCDSQOVOJSRYMB
      if (entry.address === "KGUYGYFKSHCXPSJAMYBZKRM9EXGBL9ZKYXJITVRLQFYZKEFPXOCDVTLE9ODVAHNSUZNVSJADRHDMPWQRU") {
        entry.address =     "FM9TXYBQMDBABOBGGDCSGWLCJIHSWRZSFLNJXUGZRJOFWKYAUBDNQBQBEA9KHHBIWXURCDSQOVOJSRYMB";
      }
    });


    rest.forEach((entry) => {
      var sameBalanceIRI = parseInt(proposedSnapshotBalances[entry.address]) === parseInt(entry.balance);
      if (!sameBalanceIRI) {
          console.log("FATAL ERROR: Balance incorrect for: ", entry.address);
          console.log("Balance (proposed snapshot cases vs. IRI): ", entry.balance, parseInt(proposedSnapshotBalances[entry.address]))
      }
    });

    console.log("Done checking balances.");

    console.log("----");
    console.log("verifing key reuse of addresses:");
    console.log("checking Key Reuse Cases ... (", keyReuseCases.length, ")");
    for (let entry of keyReuseCases) {
        //validate the provided bundles
        console.log("# validating: " + entry.address);
        if (entry.bundles) {
          let validationResults = await Promise.all(entry.bundles.map(async (bundle) => {
            try {
              return (await validateBundle(bundle));
            } catch(e) {
              return false;
            }
          }));
          let validSigCount = validationResults.filter(r => r).length;
          if(validSigCount < 2) {
             console.log("WARNING: Number of valid signatures was less than 2 - probably used old (Curl) signature: ", validSigCount, "balance:", entry.balance, " :: ", entry.bundles);
          }
        }
    }

}

const main = async() => {
  validateSnapshot();
};

main();
