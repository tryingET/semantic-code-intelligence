import { createServer } from 'node:net';

export async function canBindTcp(host: string): Promise<boolean> {
    return await new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.listen(0, host, () => {
            server.close(() => resolve(true));
        });
    });
}
