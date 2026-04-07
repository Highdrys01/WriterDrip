(function () {
    const MIN_DURATION_MINS = 1;
    const MAX_DURATION_MINS = 10080;
    const CORRECTION_INTENSITIES = Object.freeze(['suggested', 'low', 'medium', 'high']);
    const CORRECTION_INTENSITY_SET = new Set(CORRECTION_INTENSITIES);

    function normalizeCorrectionIntensity(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return CORRECTION_INTENSITY_SET.has(normalized) ? normalized : 'suggested';
    }

    function sanitizeDraftText(text) {
        return String(text)
            .replace(/\r\n?/g, '\n')
            .replace(/\t/g, '    ')
            .replace(/\u00A0/g, ' ')
            .replace(/[\u2028\u2029]/g, '\n')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    }

    function estimateMinimumDurationSeconds(text) {
        let totalSeconds = 0;
        let paragraphBreaks = 0;

        for (const char of Array.from(text)) {
            if (char === '\n') {
                totalSeconds += 0.8;
                paragraphBreaks += 1;
                continue;
            }

            if (char === ' ') {
                totalSeconds += 0.05;
                continue;
            }

            if (['.', '!', '?'].includes(char)) {
                totalSeconds += 0.24;
                continue;
            }

            if ([',', ';', ':'].includes(char)) {
                totalSeconds += 0.16;
                continue;
            }

            totalSeconds += 0.11;
        }

        totalSeconds += paragraphBreaks * 0.35;
        return Math.max(20, totalSeconds);
    }

    function getMinimumDurationMins(text) {
        const sanitized = sanitizeDraftText(text).trim();
        if (!sanitized) {
            return MIN_DURATION_MINS;
        }

        const seconds = estimateMinimumDurationSeconds(sanitized);
        return Math.min(MAX_DURATION_MINS, Math.max(MIN_DURATION_MINS, Math.ceil(seconds / 60)));
    }

    function analyzeDraftText(text, durationMins = null) {
        const sanitized = sanitizeDraftText(text);
        const trimmed = sanitized.trim();
        const words = sanitized.match(/[A-Za-z]+/g) || [];
        const letters = sanitized.match(/[A-Za-z]/g) || [];
        const uppercase = sanitized.match(/[A-Z]/g) || [];
        const punctuation = sanitized.match(/[.,!?;:]/g) || [];
        const newlines = sanitized.match(/\n/g) || [];
        const symbols = sanitized.match(/[^A-Za-z0-9\s.,!?;:'"()\-]/g) || [];

        let totalWordLength = 0;
        for (const word of words) {
            totalWordLength += word.length;
        }

        const charCount = Array.from(sanitized).length;
        const wordCount = words.length;
        const averageWordLength = wordCount ? totalWordLength / wordCount : 0;
        const letterCount = letters.length;
        const uppercaseCount = uppercase.length;
        const punctuationRatio = punctuation.length / Math.max(1, charCount);
        const newlineRatio = newlines.length / Math.max(1, charCount);
        const uppercaseRatio = uppercaseCount / Math.max(1, letterCount);
        const symbolRatio = symbols.length / Math.max(1, charCount);
        const looksStructured = /[{}[\]<>`=_]/.test(sanitized) ||
            (symbolRatio > 0.018 && punctuationRatio < 0.05) ||
            uppercaseRatio > 0.3;
        const minimumDurationMins = getMinimumDurationMins(trimmed);
        const safeDurationMins = Number.isFinite(durationMins) && durationMins > 0 ? durationMins : minimumDurationMins;
        const secondsPerChar = (safeDurationMins * 60) / Math.max(1, charCount);

        const analysis = {
            sanitized,
            trimmed,
            charCount,
            wordCount,
            letterCount,
            uppercaseCount,
            averageWordLength,
            punctuationRatio,
            newlineRatio,
            uppercaseRatio,
            symbolRatio,
            looksStructured,
            minimumDurationMins,
            safeDurationMins,
            secondsPerChar
        };

        return {
            ...analysis,
            suggestedCorrectionIntensity: suggestCorrectionIntensity(analysis)
        };
    }

    function suggestCorrectionIntensity(metricsOrText, durationMins = null) {
        const metrics = typeof metricsOrText === 'string'
            ? analyzeDraftText(metricsOrText, durationMins)
            : metricsOrText;

        if (!metrics || !metrics.charCount) {
            return 'medium';
        }

        if (metrics.looksStructured || metrics.symbolRatio > 0.018 || metrics.charCount < 80 || metrics.wordCount < 16) {
            return 'low';
        }

        let score = 0;
        if (metrics.charCount >= 180) {
            score += 1;
        }
        if (metrics.charCount >= 700) {
            score += 1;
        }
        if (metrics.wordCount >= 36) {
            score += 0.8;
        }
        if (metrics.secondsPerChar >= 4.2) {
            score += 0.8;
        }
        if (metrics.secondsPerChar < 1.4) {
            score -= 0.6;
        }
        if (metrics.punctuationRatio >= 0.045) {
            score += 0.35;
        }
        if (metrics.newlineRatio >= 0.014) {
            score += 0.25;
        }
        if (metrics.averageWordLength >= 4.8) {
            score += 0.2;
        }
        if (metrics.uppercaseRatio >= 0.18) {
            score -= 0.9;
        }
        if (metrics.symbolRatio >= 0.012) {
            score -= 0.6;
        }

        if (score >= 2.4) {
            return 'high';
        }
        if (score <= 0.75) {
            return 'low';
        }
        return 'medium';
    }

    globalThis.WriterDripShared = Object.freeze({
        MIN_DURATION_MINS,
        MAX_DURATION_MINS,
        CORRECTION_INTENSITIES,
        normalizeCorrectionIntensity,
        sanitizeDraftText,
        estimateMinimumDurationSeconds,
        getMinimumDurationMins,
        analyzeDraftText,
        suggestCorrectionIntensity
    });
}());
