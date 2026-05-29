import { createServer } from 'node:net';

export async function canBindTcp(host: string, port = 0): Promise<boolean> {
    return await new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}
