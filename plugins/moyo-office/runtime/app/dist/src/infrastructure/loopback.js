"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loopback = void 0;
exports.isLoopbackHost = isLoopbackHost;
exports.canListen = canListen;
exports.chooseLoopback = chooseLoopback;
exports.listenLoopback = listenLoopback;
const node_net_1 = require("node:net");
/**
 * Loopback addresses for every local server (web, client, preview, llama-server). On some Windows
 * machines binding 127.0.0.1 fails with WSAEFAULT (10014) for every program, first now and then and
 * later for good, while ::1 keeps working (seen 2026-10-07 with banking security software
 * installed; Claude Code was unaffected because it only connects outward). A single choice at
 * startup was not enough: five good probes were followed by failures minutes later. So each listen
 * tries the preferred address, retries EFAULT briefly, and falls back to the other loopback; after
 * a fallback the other address becomes preferred. Both addresses are reachable only from this PC.
 */
exports.loopback = {
    /** Preferred address passed to listen(). */
    address: '127.0.0.1',
    /** Preferred address as written in URLs and Host headers. */
    label: '127.0.0.1',
};
const addresses = [
    { address: '127.0.0.1', label: '127.0.0.1' },
    { address: '::1', label: '[::1]' },
];
/** A Host header naming a loopback address and this port; names (localhost, other domains) are refused. */
function isLoopbackHost(host, port) {
    return addresses.some((a) => host === `${a.label}:${port}`);
}
function canListen(address) {
    return new Promise((done) => {
        const probe = (0, node_net_1.createServer)();
        probe.once('error', () => done(false));
        probe.listen(0, address, () => probe.close(() => done(true)));
    });
}
/** Startup check: prefer ::1 when 127.0.0.1 fails any of a few binds and ::1 works. */
async function chooseLoopback(probe = canListen) {
    let ipv4 = true;
    for (let i = 0; i < 5 && ipv4; i++)
        ipv4 = await probe('127.0.0.1');
    if (!ipv4 && (await probe('::1')))
        prefer('::1');
    return exports.loopback.label;
}
function prefer(address) {
    const chosen = addresses.find((a) => a.address === address);
    exports.loopback.address = chosen.address;
    exports.loopback.label = chosen.label;
}
/**
 * Listens on a loopback address and returns the label it bound (for URLs). EFAULT is retried
 * briefly on each address before moving to the other; any other error is thrown as is.
 */
async function listenLoopback(server, port, options = {}) {
    const order = options.ipv4Only
        ? ['127.0.0.1']
        : [exports.loopback.address, ...addresses.map((a) => a.address).filter((a) => a !== exports.loopback.address)];
    let last;
    for (const address of order) {
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                await new Promise((done, fail) => {
                    server.once('error', fail);
                    server.listen(port, address, () => {
                        server.off('error', fail);
                        done();
                    });
                });
                if (address !== exports.loopback.address)
                    prefer(address);
                return addresses.find((a) => a.address === address).label;
            }
            catch (error) {
                last = error;
                if (error.code !== 'EFAULT')
                    throw error;
                await new Promise((done) => setTimeout(done, 40 * (attempt + 1)));
            }
        }
        // EFAULT also comes back for a port another program holds. Moving to the other loopback would
        // then share the port number with it and skip the caller's "busy → next port" handling.
        if (port !== 0 && address !== order[order.length - 1] && (await answers(address, port)))
            throw Object.assign(Error(`listen EADDRINUSE ${address}:${port} (after EFAULT)`), { code: 'EADDRINUSE' });
    }
    throw last;
}
/** Whether something accepts connections on address:port. Connects can hit EFAULT too, so retry. */
function answers(address, port, tries = 4) {
    return new Promise((done) => {
        const socket = (0, node_net_1.connect)(port, address);
        socket.once('connect', () => {
            socket.destroy();
            done(true);
        });
        socket.once('error', (e) => {
            if (e.code === 'EFAULT' && tries > 1)
                setTimeout(() => void answers(address, port, tries - 1).then(done), 40);
            // Still unreachable after retries: treat as busy rather than risk sharing the port.
            else
                done(e.code !== 'ECONNREFUSED');
        });
    });
}
//# sourceMappingURL=loopback.js.map