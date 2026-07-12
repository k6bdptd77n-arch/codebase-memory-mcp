"use strict";

const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

function atomicWriteFileSync(target, data, { mode = 0o600, fsImpl = fs } = {}) {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let fd = null;
  fsImpl.mkdirSync(dir, { recursive: true });
  try {
    fd = fsImpl.openSync(temp, "wx", mode);
    fsImpl.writeFileSync(fd, data);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(temp, target);
    try { fsImpl.chmodSync(target, mode); } catch {}
    // Persist the rename where the platform supports fsync on directories.
    try {
      const dirFd = fsImpl.openSync(dir, "r");
      fsImpl.fsyncSync(dirFd);
      fsImpl.closeSync(dirFd);
    } catch {}
  } catch (error) {
    if (fd !== null) try { fsImpl.closeSync(fd); } catch {}
    try { fsImpl.unlinkSync(temp); } catch {}
    throw error;
  }
}

module.exports = { atomicWriteFileSync };
