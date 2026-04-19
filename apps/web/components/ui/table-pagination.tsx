'use client';

import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';

interface TablePaginationProps {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
}

export function TablePagination({
    page,
    pageSize,
    total,
    onPageChange,
}: TablePaginationProps) {
    if (total <= pageSize) return null;

    const totalPages = Math.ceil(total / pageSize);
    const start = page * pageSize + 1;
    const end = Math.min((page + 1) * pageSize, total);
    const isFirst = page === 0;
    const isLast = page >= totalPages - 1;

    const handlePrev = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        if (!isFirst) onPageChange(page - 1);
    };

    const handleNext = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        if (!isLast) onPageChange(page + 1);
    };

    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
                Showing {start}–{end} of {total}
            </p>
            <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                    <PaginationItem>
                        <PaginationPrevious
                            href="#"
                            aria-label="Previous page"
                            aria-disabled={isFirst}
                            data-disabled={isFirst || undefined}
                            tabIndex={isFirst ? -1 : 0}
                            className={
                                isFirst
                                    ? 'pointer-events-none opacity-50'
                                    : undefined
                            }
                            onClick={handlePrev}
                        />
                    </PaginationItem>
                    <PaginationItem>
                        <span className="px-2 text-sm text-muted-foreground tabular-nums">
                            Page {page + 1} of {totalPages}
                        </span>
                    </PaginationItem>
                    <PaginationItem>
                        <PaginationNext
                            href="#"
                            aria-label="Next page"
                            aria-disabled={isLast}
                            data-disabled={isLast || undefined}
                            tabIndex={isLast ? -1 : 0}
                            className={
                                isLast
                                    ? 'pointer-events-none opacity-50'
                                    : undefined
                            }
                            onClick={handleNext}
                        />
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    );
}
