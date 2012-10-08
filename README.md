== pget - segmented FTP client ==

===== usage =====
```javascript
var pget = require('pget');
pget.pget('server', port, 'username', 'password', 'remote_file', 'local_file', num_segments, function (e) {
  if (e) {
    console.error("Could not download file using pget.  %s", e.message);
    throw e;
  }
});
```