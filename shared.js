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
        const digits = sanitized.match(/\d/g) || [];
        const nonEmptyLines = trimmed ? trimmed.split('\n').map((line) => line.trim()).filter(Boolean) : [];
        const paragraphs = trimmed ? trimmed.split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean) : [];
        const sentenceWordCounts = extractSentenceWordCounts(trimmed);

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
        const digitRatio = digits.length / Math.max(1, charCount);
        const uniqueWordCount = new Set(words.map((word) => word.toLowerCase())).size;
        const uniqueWordRatio = uniqueWordCount / Math.max(1, wordCount);
        const shortWordRatio = words.filter((word) => word.length <= 3).length / Math.max(1, wordCount);
        const longWordRatio = words.filter((word) => word.length >= 8).length / Math.max(1, wordCount);
        const lineCount = nonEmptyLines.length;
        const paragraphCount = paragraphs.length;
        const bulletLineCount = nonEmptyLines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line)).length;
        const bulletLineRatio = bulletLineCount / Math.max(1, lineCount);
        const sentenceCount = sentenceWordCounts.length;
        const averageSentenceWordCount = sentenceCount
            ? sentenceWordCounts.reduce((total, count) => total + count, 0) / sentenceCount
            : 0;
        const looksStructured = /[{}[\]<>`=_]/.test(sanitized) ||
            (symbolRatio > 0.018 && punctuationRatio < 0.05) ||
            uppercaseRatio > 0.3 ||
            bulletLineRatio > 0.35 ||
            digitRatio > 0.06;
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
            digitRatio,
            uniqueWordCount,
            uniqueWordRatio,
            shortWordRatio,
            longWordRatio,
            lineCount,
            paragraphCount,
            bulletLineCount,
            bulletLineRatio,
            sentenceCount,
            averageSentenceWordCount,
            looksStructured,
            minimumDurationMins,
            safeDurationMins,
            secondsPerChar
        };

        const recommendation = buildCorrectionRecommendation(analysis);

        return {
            ...analysis,
            suggestedCorrectionIntensity: recommendation.intensity,
            suggestedCorrectionReason: recommendation.reason,
            suggestedCorrectionSignals: recommendation.signals,
            suggestedCorrectionScore: recommendation.score
        };
    }

    function suggestCorrectionIntensity(metricsOrText, durationMins = null) {
        const metrics = typeof metricsOrText === 'string'
            ? analyzeDraftText(metricsOrText, durationMins)
            : metricsOrText;

        if (!metrics || !metrics.charCount) {
            return 'medium';
        }

        return buildCorrectionRecommendation(metrics).intensity;
    }

    function buildCorrectionRecommendation(metrics) {
        if (!metrics || !metrics.charCount) {
            return {
                intensity: 'medium',
                score: 0,
                signals: ['No draft loaded yet.'],
                reason: 'Suggested stays medium until there is enough draft text to analyze.'
            };
        }

        let score = 0;
        const positiveSignals = [];
        const cautionSignals = [];

        function reward(value, reason) {
            score += value;
            if (reason) {
                positiveSignals.push(reason);
            }
        }

        function caution(value, reason) {
            score -= value;
            if (reason) {
                cautionSignals.push(reason);
            }
        }

        if (metrics.looksStructured) {
            caution(2.9, 'The draft looks structured or technical.');
        }
        if (metrics.charCount < 120 || metrics.wordCount < 22) {
            caution(2.4, 'The draft is still short.');
        } else if (metrics.charCount >= 260) {
            reward(0.9, 'The draft is long enough to absorb a few corrections cleanly.');
        }
        if (metrics.charCount >= 900) {
            reward(1.1, 'The draft is long-form rather than just a quick note.');
        }

        if (metrics.wordCount >= 55) {
            reward(0.8, 'There is enough prose to space corrections out.');
        }
        if (metrics.paragraphCount >= 3) {
            reward(0.45, 'Multiple paragraphs give the run more breathing room.');
        }
        if (metrics.sentenceCount >= 6 && metrics.averageSentenceWordCount >= 8) {
            reward(0.5, 'The draft reads like full prose rather than short fragments.');
        }
        if (metrics.uniqueWordRatio >= 0.5) {
            reward(0.3, 'The wording is varied instead of repetitive.');
        }
        if (metrics.longWordRatio >= 0.18) {
            reward(0.18, 'The draft has enough longer words to support occasional recoverable corrections.');
        }

        if (metrics.secondsPerChar >= 3.2) {
            reward(0.8, 'The selected duration leaves enough pacing headroom for clean recoveries.');
        }
        if (metrics.secondsPerChar >= 5.5) {
            reward(0.45, 'The session is relaxed enough to support stronger correction spacing.');
        }
        if (metrics.secondsPerChar < 1.35) {
            caution(0.95, 'The selected duration is tight for the amount of text.');
        }

        if (metrics.punctuationRatio >= 0.028 && metrics.punctuationRatio <= 0.075) {
            reward(0.22, 'Normal prose punctuation supports natural correction spacing.');
        }
        if (metrics.newlineRatio >= 0.008 && metrics.newlineRatio <= 0.05) {
            reward(0.15, 'Paragraph breaks add natural recovery points.');
        }

        if (metrics.symbolRatio >= 0.014) {
            caution(0.95, 'The draft is symbol-heavy.');
        }
        if (metrics.digitRatio >= 0.035) {
            caution(0.75, 'The draft contains a lot of numbers.');
        }
        if (metrics.uppercaseRatio >= 0.2) {
            caution(1.2, 'The draft uses a lot of uppercase text.');
        }
        if (metrics.bulletLineRatio >= 0.28) {
            caution(0.9, 'The draft is list-heavy instead of paragraph-heavy.');
        }
        if (metrics.shortWordRatio >= 0.5 && metrics.averageSentenceWordCount < 7) {
            caution(0.45, 'The draft is made of short, clipped phrasing.');
        }
        if (metrics.uniqueWordRatio < 0.36 && metrics.wordCount >= 28) {
            caution(0.35, 'The wording is repetitive enough that stronger corrections would stand out more.');
        }

        let intensity = 'medium';
        if (score >= 2.45) {
            intensity = 'high';
        } else if (score <= 0.25) {
            intensity = 'low';
        }

        return {
            intensity,
            score,
            signals: intensity === 'high'
                ? positiveSignals.slice(0, 3)
                : intensity === 'low'
                    ? cautionSignals.slice(0, 3)
                    : [...positiveSignals.slice(0, 2), ...cautionSignals.slice(0, 2)].slice(0, 3),
            reason: buildCorrectionRecommendationReason(intensity, metrics, positiveSignals, cautionSignals)
        };
    }

    function buildCorrectionRecommendationReason(intensity, metrics, positiveSignals, cautionSignals) {
        if (intensity === 'low') {
            if (metrics.looksStructured || metrics.symbolRatio >= 0.014 || metrics.digitRatio >= 0.035 || metrics.uppercaseRatio >= 0.2) {
                return 'Suggested stays low because this draft looks more structured or technical than plain prose.';
            }
            if (metrics.charCount < 120 || metrics.wordCount < 22) {
                return 'Suggested stays low because this draft is short and does not need many visible corrections.';
            }
            if (metrics.secondsPerChar < 1.35) {
                return 'Suggested stays low because the selected duration is tight for this amount of text.';
            }
            return `Suggested stays low because ${pickSignal(cautionSignals, 'this draft benefits from lighter correction behavior').toLowerCase()}`;
        }

        if (intensity === 'high') {
            if (metrics.charCount >= 900 || metrics.wordCount >= 140) {
                return 'Suggested leans high because this is a long prose draft with room for more recoverable correction sequences.';
            }
            if (metrics.secondsPerChar >= 5.5 && metrics.paragraphCount >= 2) {
                return 'Suggested leans high because the draft has enough pacing headroom and paragraph structure to support stronger corrections cleanly.';
            }
            return `Suggested leans high because ${pickSignal(positiveSignals, 'this draft has enough room for stronger correction spacing').toLowerCase()}`;
        }

        if (!cautionSignals.length) {
            return 'Suggested stays medium because this draft reads like normal prose and has enough room for light corrections without overdoing them.';
        }

        const positive = pickSignal(positiveSignals, 'the draft reads like normal prose');
        const caution = pickSignal(cautionSignals, 'stronger corrections would be a little too noisy here');
        return `Suggested stays medium because ${positive.toLowerCase()}, but ${caution.toLowerCase()}.`;
    }

    function pickSignal(signals, fallback) {
        return signals && signals.length ? signals[0] : fallback;
    }

    function extractSentenceWordCounts(trimmed) {
        if (!trimmed) {
            return [];
        }

        return trimmed
            .split(/(?<=[.!?])\s+|\n+/)
            .map((chunk) => chunk.trim())
            .filter(Boolean)
            .map((chunk) => (chunk.match(/[A-Za-z]+/g) || []).length)
            .filter((count) => count > 0);
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
