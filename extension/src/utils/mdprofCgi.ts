import { spawn } from 'child_process';

/**
 * `mdprof_cgi` is a CGI program: per the Mercury User's Guide ("Using
 * mdprof"), a real deployment runs it behind a web server, invoked with the
 * requested data file / drill-down parameters in the `QUERY_STRING`
 * environment variable, and it prints HTTP headers followed by an HTML body
 * to stdout. That CGI contract means it can be invoked directly from the
 * command line with `QUERY_STRING` set, without any actual web server —
 * which is exactly what this helper does, so the extension can show real
 * deep-profiler pages without requiring the user to stand up a CGI host.
 *
 * This does NOT reimplement or approximate the deep profiler's analysis:
 * every byte of HTML returned here comes from `mdprof_cgi` itself. Link
 * click handling (see ../views/deepProfilePanel.ts) re-invokes this with a
 * new QUERY_STRING taken from the clicked link, giving real drill-down
 * navigation without a running web server.
 */
export interface CgiResult {
    ok: boolean;
    html?: string;
    error?: string;
}

export async function runMdprofCgi(cwd: string, queryString: string, timeoutMs = 20000): Promise<CgiResult> {
    return runWithEnv(cwd, queryString, timeoutMs);
}

function runWithEnv(cwd: string, queryString: string, timeoutMs: number): Promise<CgiResult> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn('mdprof_cgi', [], {
                cwd,
                shell: false,
                env: { ...process.env, QUERY_STRING: queryString, REQUEST_METHOD: 'GET', GATEWAY_INTERFACE: 'CGI/1.1' },
            });
        } catch (err) {
            resolve({ ok: false, error: `Failed to launch mdprof_cgi: ${String(err)}` });
            return;
        }
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            resolve({ ok: false, error: 'mdprof_cgi timed out.' });
        }, timeoutMs);
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ ok: false, error: `mdprof_cgi could not be run: ${String(err)}. Ensure your Mercury installation's bin directory is on PATH.` });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0 && !stdout) {
                resolve({ ok: false, error: stderr.trim() || `mdprof_cgi exited with code ${code}.` });
                return;
            }
            // Strip the CGI response headers (a header block terminated by a
            // blank line) to get just the HTML body.
            const sep = stdout.indexOf('\n\n');
            const html = sep >= 0 ? stdout.slice(sep + 2) : stdout;
            resolve({ ok: true, html });
        });
    });
}
