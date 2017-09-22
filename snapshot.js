const IOTA = require('iota.lib.js');
const {
    promisify
} = require('util');

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

var iotaNode = 'http://localhost:14265'

//skip afew addresses with a lot of transactions and dust iota balance:
var skipAddresses = {}
skipAddresses['999999999999999999999999999999999999999999999999999999999999999999999999999999999'] = 0;
skipAddresses['AKPRHIRZWT9XBITZMLRJEYNNTFDNZHSRUXCFKVAWCQDEBOVDPSURB9YYVJ9NXV9YCRSZKUYLHCBPAGBDZ'] = 10;
skipAddresses['RMFUE9LQPVINRNCY9UQG9NURPGRGRKVPBS9TMJDRR9THVLDWVKSKNYGATP9GFTGWSMJPBS9A9RYYWHKCW'] = 1;
skipAddresses['LGZ9YCSHKCFQJFFQTRRGSNAHFVCBUYYDVNIJPVBMFOYPPFREKNQVTWSVNFLKZTVWJOOAFGALASNSSAVD9'] = 3;
skipAddresses['YYMKSTBMFBYQPYQHZEHHBNYCODMJJCOYDYNOBSQR9BAMSJUTCTO9CEIUFBBW9FLUAIHRPLXIKXMAWTBCW'] = 3;
skipAddresses['TECQVRG9MSCZDSLL9FFRVEG9HPJCBQHJSJPQITMRYZZFBEKSGRLKDKAVZRWWJHKTVLQVAVQG9DHBGJASW'] = 995;

const MAX_PER_CHECK = 100;
const CATEROGIES_TO_COLLECT = ['CURL_UNUSED', 'CURL_USED', 'KEY_REUSE', 'DUST'];
const DUST_THRESHOLD = 0;

// construct iota.lib.js instance
let iota = new IOTA({
    provider: iotaNode
});

const PfindTransactions = promisify(iota.api.findTransactions.bind(iota.api));
const PgetTransactionsObjects = promisify(iota.api.getTransactionsObjects.bind(iota.api));


const latestStateWithCategory = async() => {
    // request latestState from IRI node:
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
    const ixiDetail = [];
    for (let address in ixiBalances) {
        ixiDetail.push({
            address: address,
            balance: ixiBalances[address]
        });
    }

    // FIRST VALIDATION
    // Check if total sum is equal to the supply 2779530283277761
    var totalSupply = (Math.pow(3, 33) - 1) / 2
    var snapshotBalance = 0;
    for (var key in ixiBalances) {
        if (ixiBalances.hasOwnProperty(key)) {
            snapshotBalance += parseInt(ixiBalances[key]);
        }
    }

    console.log("BALANCE CORRECT: ", snapshotBalance === totalSupply);

    //snapshot file from IRI - from gitHub
    let Aug_08_Data = await doRequest("https://raw.githubusercontent.com/iotaledger/iri/c23298fb27bb48cdd166abae8a8792d2f975ff79/src/main/resources/Snapshot.txt");
    const Aug_08_Detail = Aug_08_Data
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

    const Aug_08_Balances = {};
    Aug_08_Detail.forEach(e => Aug_08_Balances[e.address] = e.balance);


    // Find out which addresses only contain dust
    console.log("# Find out which addresses only contain dust");
    let curlAlive = Aug_08_Detail.filter(e => e.address in ixiBalances).map(e => e.address);
    let dust = ixiDetail.filter(e => e.balance < DUST_THRESHOLD && !curlAlive.includes(e.address)).map(e => {
        e.category = 'DUST';
        return e;
    });

    // determine all Aug_08 address that still have balance in latestState
    console.log("# Determining all Aug_08 address that still have balance in latestState...");
    let result = curlAlive.map(address => {
        let balance = ixiBalances[address];
        let category;
        if (balance == Aug_08_Balances[address]) {
            // Address hasn't been used since Curl snapshot
            category = 'CURL_UNUSED';
        } else {
            // Only some of the funds were moved
            balance = ixiBalances[address];
            category = 'CURL_USED';
        }
        return {
            address: address,
            balance: balance,
            category: category
        };
    }).concat(dust);

    curlResults = result.filter(e => CATEROGIES_TO_COLLECT.indexOf(e.category) != -1);
    var curlValues = curlResults.map((a) => a.balance)
    var curlSum = curlValues.reduce((a, b) => {return a + b;}, 0);


    let collected = Array.from(result.map(e => e.address));
    // Those we haven't assigned a category to yet.
    let rest = ixiDetail.filter(e => !collected.includes(e.address));

    let steps = Math.floor(rest.length / MAX_PER_CHECK);
    console.log("# Determining all latestState address that have reused the private key...");
    let constructPromise = async(e) => {
        if (e.address in skipAddresses) {
          //TODO add 2 bundles as proof
          e.category = 'KEY_REUSE';
          return e;
        }
        let hashes = await PfindTransactions({
            addresses: [e.address]
        });
        //need at least 3 txs to be a KEY_REUSE (+,-,-)
        if (hashes.length <= 2) {
          e.category = 'NONE';
          return e;
        }
        let objects = await PgetTransactionsObjects(hashes);

        // 1506096012 is timestamp of last milestone
        let spends = objects.filter(o => o.value < 0 && o.timestamp < 1506096013);

        let spendCount = {};
        spends.forEach(spend => {
          if(!(spend.bundle in spendCount)) {
            spendCount[spend.bundle] = spend;
          }
        });

        let uniqueSpends = Object.keys(spendCount);

        if (uniqueSpends.length > 1) {
          e.category = 'KEY_REUSE';
          e.bundles = uniqueSpends;
        } else {
          e.category = 'NONE';
        }
        return e;
    };

    for (let i = 0; i <= steps; i++) {
        console.log("# steps: " + i + " / " + steps);
        let chunk = rest.slice(i * MAX_PER_CHECK, (i + 1) * MAX_PER_CHECK);
        let promises = await Promise.all(chunk.map(constructPromise));

        result = result.concat(promises);
    }

    keyReuseResults = result.filter(e => e.category === 'KEY_REUSE');
    var keyReuseValues = keyReuseResults.map((a) => a.balance)
    var keyReuseSum = keyReuseValues.reduce((a, b) => {return a + b;}, 0);

    fs.writeFileSync("latestStateWithCategory_pre.json", JSON.stringify(result))
    fs.writeFileSync("latestStateWithCategory_Curl_Reuse.json", JSON.stringify( curlResults.concat(keyReuseResults)))

    //Move funds to IOTA foundation address:
    var move_address = "FFUIAREGAAAHNTPJRGRFCNCNOTKTKPWJEGUDWQHZVVO9MTAXZIDMXBMWJXTLUBHNFNKYCCTQUXOUYFKX9"

    console.log("Sum of Curl snapshot addresses, moved to IF address: " + curlSum);
    console.log("Sum of key reused addresses, moved to IF address: " + keyReuseSum);
    var sum = curlSum + keyReuseSum
    console.log("Total Sum moved to IF address: " + sum);
    console.log("IF address: " + move_address);

    var IF_address = {
      address: move_address,
      balance: sum,
      category: 'NONE'
    }
    result = result.concat(IF_address);

    //filter out the Curl addresses & key reuses
    result = result.filter(e => e.category === 'NONE');
    var Totalvalues = result.map((a) => a.balance)
    var TotalSum = Totalvalues.reduce((a, b) => {return a + b;}, 0);
    console.log("BALANCE CORRECT: ", TotalSum === totalSupply, TotalSum, totalSupply);

    fs.writeFileSync("latestStateWithCategory_post.json", JSON.stringify(result))

    return result;
};


var validateSnapshot = function(latestState) {

    var snapshotUrl = 'https://transfer.sh/LFvsv/snapshot_216223.json'

    request(snapshotUrl, function (error, response, body) {

        var snapshot = JSON.parse(body);
        var snapshotBalances = {};
        snapshot.forEach(e => snapshotBalances[e.address] = e.balance);

        var numEntries = snapshot.length;

        console.log("VALIDATING SNAPSHOT ENTRIES: ", numEntries);
        // We now compare the snapshot to the latest state
        latestState.forEach(function(entry) {

            var address = entry.address;
            var balance = entry.balance;

            var sameBalance = parseInt(snapshotBalances[address]) === parseInt(balance);

            if (!sameBalance) {
                console.log("FATAL ERROR: Balance incorrect for: ", address);
                console.log("Balance (proposed snapshot vs. local): ", balance, parseInt(snapshotBalances [address]))
            }

            // now we remove the address from the snapshotBalances
            delete snapshotBalances[address];
        })

        console.log("LATEST STATE EQUALS SNAPSHOT: ", Object.keys(snapshotBalances).length === 0 && snapshotBalances.constructor === Object);

        //format for Snapshot.txt
        var latestStateBalances = '';
        latestState.forEach(e => latestStateBalances += e.address + ":" + e.balance +"\n");
        fs.writeFileSync("nextSnapshot.txt", latestStateBalances)
    })

}


const main = async() => {
  let latestState = await latestStateWithCategory();
  validateSnapshot(latestState);
};

main();
