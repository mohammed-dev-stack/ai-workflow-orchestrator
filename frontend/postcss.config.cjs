// frontend/postcss.config.js
// إعدادات PostCSS — يُستخدم مع Tailwind CSS و Autoprefixer

/** @type {import('postcss').Config} */
module.exports = {
    plugins: {
        // ============================================================
        // Tailwind CSS — إطار عمل التصميم الرئيسي
        // ============================================================
        tailwindcss: {},

        // ============================================================
        // Autoprefixer — إضافة البادئات (vendor prefixes) تلقائياً
        // ============================================================
        autoprefixer: {
            overrideBrowserslist: [
                '>0.2%',
                'not dead',
                'not op_mini all',
                'last 2 versions',
            ],
            flexbox: true,
            grid: true,
        },

        // ============================================================
        // CSS Nano — ضغط وتحسين CSS (في الإنتاج فقط)
        // ============================================================
        ...(process.env.NODE_ENV === 'production' && {
            cssnano: {
                preset: [
                    'default',
                    {
                        discardComments: {
                            remove: (comment) => {
                                if (!comment || typeof comment.text !== 'string') {
                                    return true;
                                }
                                const text = comment.text;
                                return !text.includes('@license') && !text.includes('@copyright');
                            },
                        },
                        mergeRules: true,
                        colormin: true,
                        normalizeWhitespace: true,
                    },
                ],
            },
        }),
    },
};