const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function test() {
    const SQL = await initSqlJs({ locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file) });
    const dbPath = path.join(__dirname, 'data', 'gtfs_stops_idpk.db');
    const fileBuffer = fs.readFileSync(dbPath);
    const idpkDb = new SQL.Database(fileBuffer);

    let results = [];
    let res = idpkDb.exec('SELECT route_id, route_short_name, route_long_name FROM routes');
    if (res.length > 0) {
        res[0].values.forEach(v => {
            let routeId = v[0].trim();
            let routeShortOrig = v[1] ? v[1].trim() : '';
            let routeLongOrig = v[2] ? v[2].trim() : '';
            let routeShortClean = routeShortOrig.replace(/[\"\'\r\n]+/g, '').trim();
            let num = parseInt(routeShortClean);
            if (!isNaN(num)) {
                const inRange = (num >= 400621 && num <= 405611) ||
                                (num >= 430432 && num <= 440649) ||
                                (num >= 450411 && num <= 475211) ||
                                (num >= 490722 && num <= 496711);
                if (inRange) results.push(routeShortOrig);
            }
        });
    }
    console.log('Total routes matched inRange:', results.length);
}
test();
