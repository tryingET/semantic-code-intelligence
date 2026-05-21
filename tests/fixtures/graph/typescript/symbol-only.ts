export function uniqueGraphTarget() {
    return uniqueGraphHelper();
}

export function uniqueGraphHelper() {
    return 1;
}

export function uniqueGraphCaller() {
    return uniqueGraphTarget();
}
