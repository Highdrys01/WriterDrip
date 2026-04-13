/*
 * SPDX-License-Identifier: MIT
 * WriterDrip source attribution
 * Copyright (c) 2026 WriterDrip contributors
 * If you reuse substantial parts of this project, please keep credit to:
 * https://github.com/Highdrys01/WriterDrip
 */

(function () {
    const MIN_DURATION_MINS = 1;
    const MAX_DURATION_MINS = 10080;
    const CORRECTION_INTENSITIES = Object.freeze(['suggested', 'low', 'medium', 'high']);
    const CORRECTION_INTENSITY_SET = new Set(CORRECTION_INTENSITIES);
    const WORD_REGEX = /\p{L}+/gu;
    const LETTER_REGEX = /\p{L}/gu;
    const UPPERCASE_REGEX = /\p{Lu}/gu;
    const SYMBOL_REGEX = /[^\p{L}\d\s.,!?;:'"()\-]/gu;

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

    function normalizeDurationMins(value, minimumDurationMins = MIN_DURATION_MINS) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }

        const rounded = Math.ceil(numeric);
        return Math.min(MAX_DURATION_MINS, Math.max(Math.max(MIN_DURATION_MINS, minimumDurationMins || MIN_DURATION_MINS), rounded));
    }

    function resolveAnalyzeOptions(durationOrOptions = null, maybeOptions = null) {
        if (durationOrOptions && typeof durationOrOptions === 'object' && !Array.isArray(durationOrOptions)) {
            return {
                durationMins: Number(durationOrOptions.durationMins),
                correctionIntensity: normalizeCorrectionIntensity(durationOrOptions.correctionIntensity)
            };
        }

        return {
            durationMins: Number(durationOrOptions),
            correctionIntensity: normalizeCorrectionIntensity(maybeOptions?.correctionIntensity)
        };
    }

    function analyzeDraftText(text, durationOrOptions = null, maybeOptions = null) {
        const analyzeOptions = resolveAnalyzeOptions(durationOrOptions, maybeOptions);
        const sanitized = sanitizeDraftText(text);
        const trimmed = sanitized.trim();
        const words = sanitized.match(WORD_REGEX) || [];
        const letters = sanitized.match(LETTER_REGEX) || [];
        const uppercase = sanitized.match(UPPERCASE_REGEX) || [];
        const punctuation = sanitized.match(/[.,!?;:]/g) || [];
        const newlines = sanitized.match(/\n/g) || [];
        const symbols = sanitized.match(SYMBOL_REGEX) || [];
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
        const punctuationCount = punctuation.length;
        const punctuationRatio = punctuationCount / Math.max(1, charCount);
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
        const safeDurationMins = Number.isFinite(analyzeOptions.durationMins) && analyzeOptions.durationMins > 0
            ? analyzeOptions.durationMins
            : minimumDurationMins;
        const secondsPerChar = (safeDurationMins * 60) / Math.max(1, charCount);
        const effectiveWpm = wordCount / Math.max(safeDurationMins, 1 / 60);

        const analysis = {
            sanitized,
            trimmed,
            charCount,
            wordCount,
            letterCount,
            uppercaseCount,
            averageWordLength,
            punctuationCount,
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
            secondsPerChar,
            effectiveWpm
        };

        const recommendation = buildCorrectionRecommendation(analysis);
        const durationRecommendation = buildDurationRecommendation(
            analysis,
            recommendation,
            analyzeOptions.correctionIntensity
        );

        return {
            ...analysis,
            suggestedCorrectionIntensity: recommendation.intensity,
            suggestedCorrectionReason: recommendation.reason,
            suggestedCorrectionSignals: recommendation.signals,
            suggestedCorrectionScore: recommendation.score,
            suggestedCorrectionNormalizedScore: recommendation.normalizedScore,
            suggestedCorrectionLabel: recommendation.label,
            requestedCorrectionIntensity: analyzeOptions.correctionIntensity,
            recommendedDurationIntensity: durationRecommendation.intensity,
            recommendedDurationMins: durationRecommendation.minutes,
            recommendedDurationReason: durationRecommendation.reason
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

        const punctuationPerSentence = metrics.punctuationCount / Math.max(1, metrics.sentenceCount || 1);
        const wordsPerParagraph = metrics.paragraphCount
            ? metrics.wordCount / Math.max(1, metrics.paragraphCount)
            : metrics.wordCount;
        const paragraphDensity = clamp((wordsPerParagraph - 55) / 75, 0, 1.5);
        const sentenceDensity = clamp((metrics.averageSentenceWordCount - 11) / 8, 0, 1.6);
        const maturityFactor = clamp((metrics.wordCount - 18) / 72, 0, 1.1);
        const longDraftLoad = clamp((metrics.wordCount - 90) / 170, 0, 1.6);
        const revisionOpportunityScore = clamp(
            (metrics.sentenceCount * 0.14) +
            (Math.max(0, metrics.paragraphCount - 1) * 0.26) +
            (punctuationPerSentence * 0.34),
            0,
            3.8
        );
        const compositionComfortWpm = clamp(
            42 -
            (sentenceDensity * 4.8) -
            (paragraphDensity * 4.2) -
            (longDraftLoad * 3.6) -
            (metrics.looksStructured ? -1.6 : 0),
            19,
            44
        );
        const roomyPacingScore = clamp((compositionComfortWpm - metrics.effectiveWpm) / 9, 0, 1.45) * Math.max(0.2, maturityFactor);
        const tightPacingScore = clamp((metrics.effectiveWpm - compositionComfortWpm) / 8.5, 0, 1.65);
        const veryTightPacingScore = clamp((metrics.effectiveWpm - (compositionComfortWpm + 7)) / 7.5, 0, 1.4);

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
        if (revisionOpportunityScore >= 1.45) {
            reward(
                Math.min(1.05, revisionOpportunityScore * 0.24),
                'Sentence and paragraph structure give the draft more natural correction opportunities.'
            );
        }
        if (metrics.paragraphCount >= 3) {
            reward(0.45, 'Multiple paragraphs give the run more breathing room.');
        }
        if (paragraphDensity >= 0.32) {
            reward(
                Math.min(0.72, paragraphDensity * 0.42),
                'Longer paragraphs make the draft read like sustained prose instead of short fragments.'
            );
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

        if (roomyPacingScore > 0) {
            reward(
                0.84 * roomyPacingScore,
                'The selected duration leaves enough pacing headroom for clean recoveries.'
            );
        }
        if (roomyPacingScore >= 0.7) {
            reward(
                0.38 * clamp(roomyPacingScore - 0.44, 0, 1.05),
                'The session is relaxed enough to support stronger correction spacing.'
            );
        }
        if (tightPacingScore > 0) {
            caution(
                1.12 * tightPacingScore,
                'The selected duration is tight for the amount of text.'
            );
        }
        if (veryTightPacingScore > 0) {
            caution(
                0.92 * veryTightPacingScore,
                'The draft would need to move very quickly at this duration.'
            );
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

        if (metrics.wordCount >= 140 && !metrics.looksStructured) {
            score += Math.min(0.42, longDraftLoad * 0.34);
        }

        let intensity = 'medium';
        if (score >= 2.45) {
            intensity = 'high';
        } else if (score <= 0.25) {
            intensity = 'low';
        }
        const normalizedScore = normalizeSuggestedCorrectionScore(score, metrics);
        const label = buildAdaptiveCorrectionLabel(normalizedScore, metrics);

        return {
            intensity,
            score,
            normalizedScore,
            label,
            signals: intensity === 'high'
                ? positiveSignals.slice(0, 3)
                : intensity === 'low'
                    ? cautionSignals.slice(0, 3)
                    : [...positiveSignals.slice(0, 2), ...cautionSignals.slice(0, 2)].slice(0, 3),
            reason: buildCorrectionRecommendationReason(intensity, metrics, positiveSignals, cautionSignals)
        };
    }

    function buildDurationRecommendation(metrics, correctionRecommendation = null, correctionIntensity = 'suggested') {
        const minimum = Math.max(MIN_DURATION_MINS, Number(metrics?.minimumDurationMins) || MIN_DURATION_MINS);
        if (!metrics?.trimmed) {
            return {
                intensity: 'medium',
                minutes: minimum,
                reason: 'Recommended duration will appear once there is enough draft text to analyze.'
            };
        }

        const requestedIntensity = normalizeCorrectionIntensity(correctionIntensity);
        const suggestedBlend = Number.isFinite(correctionRecommendation?.normalizedScore)
            ? correctionRecommendation.normalizedScore
            : (correctionRecommendation?.intensity === 'high'
                ? 1
                : correctionRecommendation?.intensity === 'low'
                    ? 0
                    : 0.5);
        const intensityBlend = requestedIntensity === 'suggested'
            ? clamp(suggestedBlend, 0, 1)
            : requestedIntensity === 'high'
                ? 1
                : requestedIntensity === 'low'
                    ? 0
                    : 0.5;
        const effectiveIntensity = intensityBlend < 0.34
            ? 'low'
            : intensityBlend < 0.68
                ? 'medium'
                : 'high';
        const punctuationCount = Number.isFinite(metrics.punctuationCount)
            ? metrics.punctuationCount
            : Math.round(metrics.punctuationRatio * metrics.charCount);
        const wordsPerParagraph = metrics.paragraphCount
            ? metrics.wordCount / Math.max(1, metrics.paragraphCount)
            : metrics.wordCount;
        const paragraphDensity = clamp((wordsPerParagraph - 55) / 70, 0, 1.45);
        const sentenceDensity = clamp((metrics.averageSentenceWordCount - 11) / 9, 0, 1.5);
        const longDraftLoad = clamp((metrics.wordCount - 80) / 180, 0, 1.7);
        const punctuationPerSentence = punctuationCount / Math.max(1, metrics.sentenceCount || 1);
        const revisionLoad = clamp(
            (metrics.sentenceCount * 0.1) +
            (Math.max(0, metrics.paragraphCount - 1) * 0.24) +
            (punctuationPerSentence * 0.32),
            0,
            6.5
        );
        const proseBias = metrics.looksStructured ? 0.86 : 1;
        const targetWordsPerMinute = clamp(
            52 * (
                1 - (
                    0.16 +
                    (sentenceDensity * 0.08) +
                    (paragraphDensity * 0.075) +
                    (longDraftLoad * 0.055) +
                    (revisionLoad * 0.018) +
                    (intensityBlend * 0.12)
                )
            ),
            metrics.looksStructured ? 24 : 18,
            metrics.looksStructured ? 46 : 42
        );
        const baseTypingMins = (metrics.wordCount / Math.max(1, targetWordsPerMinute)) * proseBias;
        const paragraphMins = metrics.paragraphCount <= 1
            ? 0
            : (metrics.paragraphCount - 1) * interpolateAdaptiveValue(0.55, 0.9, 1.2, intensityBlend);
        const denseParagraphMins = paragraphDensity * interpolateAdaptiveValue(1.1, 2.05, 3.1, intensityBlend);
        const sentenceMins = Math.max(0, metrics.sentenceCount - 1) *
            interpolateAdaptiveValue(0.07, 0.11, 0.16, intensityBlend);
        const longSentenceMins = sentenceDensity * Math.max(1, metrics.sentenceCount) *
            interpolateAdaptiveValue(0.08, 0.13, 0.2, intensityBlend);
        const punctuationMins = punctuationCount * interpolateAdaptiveValue(0.014, 0.022, 0.032, intensityBlend);
        const revisionMins = revisionLoad * interpolateAdaptiveValue(0.22, 0.34, 0.52, intensityBlend);
        const longDraftMins = longDraftLoad * interpolateAdaptiveValue(1.7, 3.1, 4.8, intensityBlend);
        const correctionHeadroom = interpolateAdaptiveValue(1.05, 1.13, 1.22, intensityBlend);
        const baselineHeadroomMins = interpolateAdaptiveValue(0.35, 1.2, 2.25, intensityBlend);

        let rawMinutes = (
            baseTypingMins +
            paragraphMins +
            denseParagraphMins +
            sentenceMins +
            longSentenceMins +
            punctuationMins +
            revisionMins +
            longDraftMins
        ) * correctionHeadroom + baselineHeadroomMins;

        if (metrics.looksStructured) {
            rawMinutes -= 0.7;
        }
        if (metrics.wordCount < 30) {
            rawMinutes -= 0.45;
        }
        if (metrics.charCount >= 1200) {
            rawMinutes += interpolateAdaptiveValue(0.8, 1.5, 2.4, intensityBlend);
        }
        if (metrics.paragraphCount >= 4) {
            rawMinutes += interpolateAdaptiveValue(0.7, 1.4, 2.1, intensityBlend);
        }

        const minimumFloor = minimum * interpolateAdaptiveValue(1.04, 1.18, 1.36, intensityBlend);
        const absoluteFloor = minimum + interpolateAdaptiveValue(0.2, 1.2, 2.4, intensityBlend);
        const minutes = Math.min(
            MAX_DURATION_MINS,
            Math.max(minimum, Math.ceil(Math.max(rawMinutes, minimumFloor, absoluteFloor)))
        );

        if (minutes <= minimum) {
            return {
                intensity: effectiveIntensity,
                minutes: minimum,
                reason: 'This draft is short or structured enough that the minimum duration is already a good fit.'
            };
        }

        if (metrics.looksStructured) {
            return {
                intensity: effectiveIntensity,
                minutes,
                reason: requestedIntensity === 'high'
                    ? 'Recommended duration stays conservative here because structured text keeps high correction intensity on a tighter leash.'
                    : 'Recommended duration keeps a little extra pacing headroom without overdoing corrections on structured text.'
            };
        }

        if (effectiveIntensity === 'high') {
            return {
                intensity: effectiveIntensity,
                minutes,
                reason: 'Recommended duration leaves extra room for high correction intensity across longer paragraphs, pauses, and delayed repairs.'
            };
        }

        return {
            intensity: effectiveIntensity,
            minutes,
            reason: effectiveIntensity === 'low'
                ? 'Recommended duration keeps the run light while still leaving a little more room than the hard minimum.'
                : 'Recommended duration leaves more room than the hard minimum for pacing, corrections, and cleaner recovery points.'
        };
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function interpolateAdaptiveValue(lowValue, mediumValue, highValue, blend) {
        const clampedBlend = clamp(blend, 0, 1);
        if (clampedBlend <= 0.5) {
            return lowValue + ((mediumValue - lowValue) * (clampedBlend / 0.5));
        }
        return mediumValue + ((highValue - mediumValue) * ((clampedBlend - 0.5) / 0.5));
    }

    function normalizeSuggestedCorrectionScore(score, metrics) {
        let normalized = clamp((Number(score) + 1.1) / 4.6, 0, 1);
        if (metrics?.looksStructured) {
            normalized *= 0.82;
        }
        if ((metrics?.paragraphCount || 0) >= 3 && (metrics?.wordCount || 0) >= 120) {
            normalized = Math.max(normalized, 0.56);
        }
        if ((metrics?.wordCount || 0) >= 220 && !metrics?.looksStructured) {
            normalized = Math.max(normalized, 0.68);
        }
        return clamp(normalized, 0, 1);
    }

    function buildAdaptiveCorrectionLabel(normalizedScore, metrics) {
        if (metrics?.looksStructured && normalizedScore < 0.32) {
            return 'Careful';
        }
        if (normalizedScore < 0.16) {
            return 'Minimal';
        }
        if (normalizedScore < 0.32) {
            return 'Light';
        }
        if (normalizedScore < 0.5) {
            return 'Balanced';
        }
        if (normalizedScore < 0.68) {
            return 'Active';
        }
        if (normalizedScore < 0.84) {
            return 'Dense';
        }
        return 'Intense';
    }

    function buildCorrectionRecommendationReason(intensity, metrics, positiveSignals, cautionSignals) {
        if (intensity === 'low') {
            if (metrics.looksStructured || metrics.symbolRatio >= 0.014 || metrics.digitRatio >= 0.035 || metrics.uppercaseRatio >= 0.2) {
                return 'Suggested stays careful because this draft looks more structured or technical than plain prose.';
            }
            if (metrics.charCount < 120 || metrics.wordCount < 22) {
                return 'Suggested stays light because this draft is short and does not need many visible corrections.';
            }
            if (metrics.secondsPerChar < 1.35) {
                return 'Suggested stays light because the selected duration is tight for this amount of text.';
            }
            return `Suggested stays light because ${pickSignal(cautionSignals, 'this draft benefits from lighter correction behavior').toLowerCase()}`;
        }

        if (intensity === 'high') {
            if (metrics.charCount >= 900 || metrics.wordCount >= 140) {
                return 'Suggested turns more active because this is a long prose draft with room for more recoverable correction sequences.';
            }
            if (metrics.secondsPerChar >= 5.5 && metrics.paragraphCount >= 2) {
                return 'Suggested turns more active because the draft has enough pacing headroom and paragraph structure to support stronger corrections cleanly.';
            }
            return `Suggested turns more active because ${pickSignal(positiveSignals, 'this draft has enough room for stronger correction spacing').toLowerCase()}`;
        }

        if (!cautionSignals.length) {
            return 'Suggested stays balanced because this draft reads like normal prose and has enough room for light corrections without overdoing them.';
        }

        const positive = pickSignal(positiveSignals, 'the draft reads like normal prose');
        const caution = pickSignal(cautionSignals, 'stronger corrections would be a little too noisy here');
        return `Suggested stays balanced because ${positive.toLowerCase()}, but ${caution.toLowerCase()}.`;
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
            .map((chunk) => (chunk.match(WORD_REGEX) || []).length)
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
        normalizeDurationMins,
        analyzeDraftText,
        suggestCorrectionIntensity
    });
}());
