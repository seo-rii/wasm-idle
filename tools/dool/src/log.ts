export function log(submissionId: number | false, ...args: any[]): void {
    console.log('[$LOG]', submissionId ? `[$S=${submissionId}]` : '[$S=G]', `[$T=${Date.now()}]`, ...args);
}

export function error(submissionId: number | false, ...args: any[]): void {
    console.error('[$ERR]', submissionId ? `[$S=${submissionId}]` : '[$S=G]', `[$T=${Date.now()}]`, ...args);
}