class Sandbox {
    static async create() { return new Sandbox(); }
    async runCode() { return { logs: { stdout: [], stderr: [] }, results: [], error: null }; }
    getHost(port) { return `localhost:${port}`; }
    commands = { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) };
    async kill() {}
}
module.exports = { Sandbox };
