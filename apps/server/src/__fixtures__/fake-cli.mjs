// A stand-in for the openldr CLI, for the server tests only. The server starts it the way it starts
// the real CLI: the hand-off arrives as JSON on descriptor 3, and OPENLDR_SERVED_FD is '3'. It
// touches no database. The first word of the hand-off's argv picks what it does.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, readdirSync, readFileSync, readSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';

function readHandoff() {
  if (process.env.OPENLDR_SERVED_FD !== '3') {
    process.stderr.write('not served\n');
    process.exit(9);
  }
  const stat = fstatSync(3);
  if (!stat.isFIFO() && !stat.isSocket()) {
    process.stderr.write('descriptor 3 is not a pipe\n');
    process.exit(9);
  }
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    const n = readSync(3, buf, 0, buf.length, null);
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  closeSync(3);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Every file below a folder, as { rel: base64 }. */
function listDir(dir, prefix = '') {
  const out = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, listDir(join(dir, e.name), rel));
    else out[rel] = readFileSync(join(dir, e.name)).toString('base64');
  }
  return out;
}

const handoff = readHandoff();
const [mode, ...rest] = handoff.argv;

switch (mode) {
  case 'echo':
    process.stdout.write(`${JSON.stringify(handoff.argv)}\n`);
    process.stderr.write(`${handoff.caller.username}\n`);
    break;
  case 'self':
    process.stdout.write(JSON.stringify({ argv: process.argv, env: process.env, cwd: process.cwd(), pid: process.pid, handoff }));
    break;
  case 'sleep': {
    process.on('SIGINT', () => {
      process.stdout.write('interrupted\n');
      process.exit(0);
    });
    process.stderr.write(`pid ${process.pid}\n`);
    process.stdout.write('sleeping\n');
    setTimeout(() => process.exit(0), Number(rest[0] ?? 60_000));
    break;
  }
  case 'hush': {
    // Prints nothing at all, and exits 0 on SIGINT. Writes the first file when it gets SIGINT, and
    // the second once it is listening for it.
    process.on('SIGINT', () => {
      if (rest[0]) writeFileSync(rest[0], 'sigint');
      process.exit(0);
    });
    if (rest[1]) writeFileSync(rest[1], 'ready');
    setInterval(() => {}, 60_000);
    break;
  }
  case 'stubborn': {
    process.on('SIGINT', () => {
      process.stderr.write('ignored\n');
      if (rest[0]) writeFileSync(rest[0], 'sigint');
    });
    process.stdout.write('stubborn\n');
    setInterval(() => {}, 60_000);
    break;
  }
  case 'fail':
    process.stderr.write('failed\n');
    process.exitCode = Number(rest[0] ?? 3);
    break;
  case 'cat': {
    const out = {};
    for (const token of rest) {
      if (token === '') continue;
      // `--flag=<path>` reads the path after the '='.
      const p = token.startsWith('--') ? token.slice(token.indexOf('=') + 1) : token;
      out[token] = lstatSync(p).isDirectory() ? listDir(p) : readFileSync(p).toString('base64');
    }
    process.stdout.write(JSON.stringify(out));
    break;
  }
  case 'siblings': {
    // The files in the folder that holds the given file, with their text.
    const dir = dirname(rest[0]);
    const out = {};
    for (const n of readdirSync(dir).sort()) out[n] = readFileSync(join(dir, n), 'utf8');
    process.stdout.write(JSON.stringify(out));
    break;
  }
  case 'write':
    writeFileSync(rest[0], rest[1] ?? '');
    process.stdout.write(`wrote ${rest[0]}\n`);
    process.exitCode = Number(rest[2] ?? 0);
    break;
  case 'writedir': {
    const dir = rest[0];
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'alpha');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'beta');
    writeFileSync(join(dir, 'empty.txt'), '');
    if (rest[1]) {
      symlinkSync(rest[1], join(dir, 'link.txt'));
      symlinkSync(join(rest[1], '..'), join(dir, 'linkdir'));
    }
    // A named pipe: opening it to read would wait for a writer for ever.
    if (spawnSync('mkfifo', [join(dir, 'pipe')]).status !== 0) process.stderr.write('no mkfifo\n');
    process.stdout.write(`wrote ${dir}\n`);
    break;
  }
  case 'companion':
    // The full path of a file beside the given one.
    process.stdout.write(`read ${join(dirname(rest[0]), rest[1])}\n`);
    break;
  case 'orphan': {
    // Leaves a process behind that holds this one's standard output and error open until the given
    // file exists (the test makes it), or two minutes at most.
    const code = "const fs = require('fs'); setInterval(() => { if (fs.existsSync(process.argv[1])) process.exit(0); }, 50); setTimeout(() => process.exit(0), 120000);";
    const child = spawn(process.execPath, ['-e', code, rest[0]], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    });
    process.stderr.write(`grandchild ${child.pid}\n`);
    child.unref();
    break;
  }
  case 'chatty': {
    // Leaves a process behind that writes a line to this one's standard output every 100 ms, so
    // the pipe is never quiet, until the given file exists (the test makes it), or two minutes.
    const code = "const fs = require('fs'); setInterval(() => { if (fs.existsSync(process.argv[1])) process.exit(0); process.stdout.write('tick\\n'); }, 100); setTimeout(() => process.exit(0), 120000);";
    const child = spawn(process.execPath, ['-e', code, rest[0]], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    });
    process.stderr.write(`grandchild ${child.pid}\n`);
    child.unref();
    break;
  }
  case 'lock': {
    // A folder this user cannot write in, with a file in it, so removing the tree fails.
    const sub = join(rest[0], 'locked');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'f.txt'), 'x');
    chmodSync(sub, 0o500);
    break;
  }
  case 'print':
    process.stdout.write(rest.join(' '));
    break;
  case 'twice':
    // A path twice, the second time with more after it, on both streams.
    process.stdout.write(`wrote ${rest[0]} and ${rest[0]}/sub/file\n`);
    process.stderr.write(`in ${rest[0]}\n`);
    break;
  case 'split': {
    // Writes the text in two pieces, cut at the given byte, with a pause between them.
    const text = Buffer.from(rest[0]);
    const at = Number(rest[1]);
    process.stdout.write(text.subarray(0, at));
    setTimeout(() => process.stdout.write(text.subarray(at)), 100);
    break;
  }
  case 'fill': {
    // Writes until the channel to the server stays full for a second, which happens only when the
    // server is stuck sending to its caller. Then exits at once, leaving the channel full, and puts
    // in the given file the bytes the kernel took whole. At most one 4 KiB piece more may have gone
    // in part. Node gives a spawned child a socket here, not a FIFO, so /proc/self/fd/1 cannot be
    // reopened (ENXIO). A second, non-blocking stream over descriptor 1 (public net.Socket API)
    // shows a full channel as data left waiting in user space. Tested on Linux only.
    const out = new net.Socket({ fd: 1, readable: false, writable: true });
    const piece = Buffer.alloc(4 * 1024, 121);
    let taken = 0;
    let stuck = 0;
    const check = () => {
      if (out.writableLength === 0) { stuck = 0; return void fill(); }
      stuck += 1;
      if (stuck >= 10) {
        writeFileSync(rest[0], String(taken));
        process.exit(0);
      }
      setTimeout(check, 100);
    };
    const fill = () => {
      while (out.writableLength === 0) out.write(piece, () => { taken += piece.length; });
      setTimeout(check, 100);
    };
    fill();
    break;
  }
  case 'flood': {
    // Writes this many bytes, then the marker file. Writes to a pipe block on Linux, so the
    // marker shows how far the reader let it get.
    const total = Number(rest[0]);
    const piece = Buffer.alloc(64 * 1024, 120);
    let sent = 0;
    const next = () => {
      while (sent < total) {
        sent += piece.length;
        if (!process.stdout.write(piece)) return process.stdout.once('drain', next);
      }
      if (rest[1]) writeFileSync(rest[1], 'done');
    };
    next();
    break;
  }
  default:
    process.stderr.write(`unknown mode ${mode}\n`);
    process.exitCode = 2;
}
