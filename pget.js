/*
 * This file is part of pget.
 *
 * pget is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * pget is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with pget.  If not, see <http://www.gnu.org/licenses/>.
 */
var ftp = require('ftp'), EventEmitter = require('events').EventEmitter, fs = require('fs');
var Logger = require('devnull'), logger = new Logger({level:3});

module.exports.pget = function (ftp_server, ftp_port, username, password, path, local_path, segments, cb, debug) {
  var emitter = new EventEmitter();

  var completedChunks = 0;
  var clients = [];
  var stdChunkSize = 0;

  var fd;
  try {
    if (fs.existsSync(local_path)) {
      fs.unlinkSync(local_path);
    }
    fd = fs.openSync(local_path, "wx");
  } catch (e) {
    logger.error("Could not open local file for writing.  %s", e.message);
    cb(e);
  }

  logger.debug('Setting up initial FTP connection to determine size.');
  var fc = new ftp({host:ftp_server, port:ftp_port});
  fc.on('connect', function () {
    logger.debug('Connected okay, authorizing.');

    fc.auth(username, password, function (e) {
      if (e) {
        logger.error("Could not auth %s.  %s", username, e.message);
        cb(e);
      }

      logger.debug('Authentication was fine.');
      emitter.emit('connect_ok');
    });
  });
  fc.on('error', function (e) {
    logger.debug('Could not initiate connection to FTP server.');
    cb(e);
  });

  fc.on('end', function () {
    logger.debug('FTP connection ended.');
  });

  fc.on('close', function (hasError) {
    logger.debug("FTP connection closed - error status: %s", hasError);
    if (hasError) {
      cb(new Error('FTP connection closed with an error.'));
    }
  });

  fc.on('timeout', function () {
    logger.debug("FTP connection timed out.");
    cb(new Error("FTP connection timed out."));
  });

  fc.connect();

  emitter.on('connect_ok', function () {
    logger.debug('Connected to FTP, retrieving size of file.');
    fc.size(path, function (e, size) {
      if (e) {
        logger.error("Could not retrieve the size of the file. %s", e.message);
        cb(e);
      }

      logger.debug('File size of %s is %s', path, size);
      emitter.emit('begin_download', size);
      fc.end();
    });
  });

  emitter.on('begin_download', function (size) {
    var chunkSize = stdChunkSize = Math.floor(size / segments);
    var leftover = size % segments;
    logger.debug("Downloading %s in %d chunks of size %d (with %d leftover) to %s.", size, segments, chunkSize, leftover, local_path);

    for (var i = 0; i < segments; i++) {
      (function (currClient) {
        logger.debug('Spawning client %d', currClient);
        clients[currClient] = new ftp({host:ftp_server, port:ftp_port});
        clients[currClient].on('connect', function () {
          logger.debug('client %d authenticating.', currClient);

          clients[currClient].auth(username, password, function (e) {
            if (e) {
              logger.error("Could not authenticate user.  %s", e.message);
              cb(e);
            }

            clients[currClient].binary(function (e) {
              if (e) {
                logger.error("Could not set binary transfer mode.  %s", e.message);
                cb(e);
              }

              var offset = currClient * chunkSize;
              if (currClient == 0) {
                // first chunk starts at 0, so no retr command
                emitter.emit('snag_chunk', cb, clients[currClient], currClient === (segments - 1) ? chunkSize + leftover : chunkSize, currClient);
              } else {
                clients[currClient].restart(offset, function (e) {
                  if (e) {
                    logger.error("Could not restart file download from FTP server. %s", e.message);
                    cb(e);
                  }

                  emitter.emit('snag_chunk', cb, clients[currClient], currClient === (segments - 1) ? chunkSize + leftover : chunkSize, currClient);
                });
              }
            });
          });
        });
        clients[currClient].connect();
      })(i);
    } // end for
  });

  emitter.on('chunk_completed', function (segmentCount, buffer, position) {
    completedChunks++;

    logger.debug("Writing %d data to the file starting at %d - total size of file is now %d.", buffer.length, position, position + buffer.length);

    var wroteBytes = fs.writeSync(fd, buffer, 0, buffer.length, position);
    if (wroteBytes != buffer.length) {
      logger.error("Could not write buffer to file.");
      cb(new Error("Could not write buffer to file."));
    }

    if (segments == completedChunks) {
      logger.debug('All chunks completed.');
      emitter.emit('download_complete');
    }
  });

  emitter.on('download_complete', function () {
    logger.debug('Download completed, calling back.');
    fs.closeSync(fd);
    cb(undefined);
  });

  emitter.on('snag_chunk', function (cb, conn, segmentSize, segmentCount) {
    conn.get(path, function (e, stream) {
      if (e) {
        logger.error("Could not retrieve file from FTP server. %s", e.message);
        cb(e);
      }

      logger.debug("Grabbing chunk %d using size %d.", segmentCount, segmentSize);

      var chunk = new Buffer(segmentSize);
      var currOffset = 0;
      var completed = false;

      stream.on('success', function () {
        logger.debug("Segment %d completed downloading for size %d.", segmentCount, segmentSize);
        conn.end();
        emitter.emit('chunk_completed', segmentCount, chunk, segmentCount * stdChunkSize);
      });

      stream.on('error', function (e) {
        logger.error("Could not download chunk.  %s", e.message);
        conn.end();
        cb(e);
      });

      stream.on('data', function (buffer) {
        if (completed) {
          logger.debug("Chunk data download completed, ignoring.");
          return;
        }

        logger.debug('Sucked down a buffer of size %d for segment %d - segment size is %d.', buffer.length, segmentCount, segmentSize);

        if (currOffset + buffer.length >= segmentSize) {
          logger.debug("Downloaded buffer (%d) for chunk %d is gte than our segment size + buffer (%d), so we'll do this in one step. [%d - %d].", buffer.length, segmentCount, segmentSize, currOffset, segmentSize-currOffset);
          buffer.copy(chunk, currOffset, 0, segmentSize - currOffset);

          completed = true;
          stream.end();
        } else {
          logger.debug("Downloaded buffer (%d) for chunk %d is smaller than our segment size (%d), so we'll have to do this in multiple steps [%d - %d].", buffer.length, segmentCount, segmentSize, currOffset, segmentSize-currOffset);
          buffer.copy(chunk, currOffset, 0);
          currOffset += buffer.length;
        }
      });
    });
  });
};