const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const searchRegex = (value) => ({ $regex: escapeRegex(String(value).trim()).slice(0, 100), $options: "i" });

const parsePagination = (query = {}, { defaultLimit = 12, maxLimit = 50 } = {}) => {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));

    return { page, limit, skip: (page - 1) * limit };
};

const paginationMeta = ({ page, limit }, total) => ({
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
});

module.exports = { escapeRegex, searchRegex, parsePagination, paginationMeta };
