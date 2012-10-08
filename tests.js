/*
 * To create a file (or two) to test the segmented download with - use dd on the server to generate random files:
 *  dd if=/dev/urandom of=10k.file bs=1k count=10
 *  dd if=/dev/urandom of=1gb.file bs=1k count=1000000
 */

var pget = require('./pget');

module.exports = {
  testSegmented:function (test) {
    test.expect(1);

    pget.pget('10.211.55.5', 21, 'ftptest', 'ftptest', '/137m.file', '/tmp/137m.file', 5, function (e) {
      if (e) {
        console.error("Could not download file using pget.  %s", e.message);
        throw e;
      }

      console.log("Downloaded file successfully.");

      test.ok(true, "Download completed.");
      test.done();
    });
  }
}