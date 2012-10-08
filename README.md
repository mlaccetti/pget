### pget - segmented FTP client

** note **

Please note that this library depends on my current fork of node-ftp,
available at https://github.com/mlaccetti/node-ftp.  If my pull request is yanked, I'll update accordingly.

###### usage
```javascript
var pget = require('pget');
pget.pget('server', port, 'username', 'password', 'remote_file', 'local_file', num_segments, function (e) {
  if (e) {
    console.error("Could not download file using pget.  %s", e.message);
    throw e;
  }
});
```