const ledger = { total: 0 };

export function ObliqueMarker(): number {
    ledger.total += 1;
    return ledger.total;
}
