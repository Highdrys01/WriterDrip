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
    const KEEP_AWAKE_ENABLED_KEY = 'writerdripKeepAwakeEnabled';
    const CORRECTION_INTENSITIES = Object.freeze(['suggested', 'low', 'medium', 'high']);
    const CORRECTION_INTENSITY_SET = new Set(CORRECTION_INTENSITIES);
    const RECOVERABLE_ATTENTION_CODES = Object.freeze([
        'editor-not-ready',
        'editor-focus-failed',
        'manual-interaction',
        'tab-suspended',
        'typing-context-lost'
    ]);
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
        const correctionPreview = buildCorrectionPreview(
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
            recommendedDurationReason: durationRecommendation.reason,
            correctionPreview
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
                0.56 * roomyPacingScore,
                'The selected duration leaves enough pacing headroom for clean recoveries.'
            );
        }
        if (roomyPacingScore >= 0.7) {
            reward(
                0.18 * clamp(roomyPacingScore - 0.44, 0, 1.05),
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

        const normalizedScore = normalizeSuggestedCorrectionScore(score, metrics);
        let intensity = 'medium';
        if (metrics.looksStructured) {
            intensity = normalizedScore <= 0.22 ? 'low' : 'medium';
        } else if (
            normalizedScore >= 0.9 ||
            (normalizedScore >= 0.82 &&
                metrics.wordCount >= 180 &&
                metrics.paragraphCount >= 2 &&
                metrics.averageSentenceWordCount >= 10)
        ) {
            intensity = 'high';
        } else if (normalizedScore <= 0.16) {
            intensity = 'low';
        }
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
        const intensityBlend = getCorrectionIntensityBlend(requestedIntensity, correctionRecommendation);
        const effectiveIntensity = getEffectiveIntensityFromBlend(intensityBlend);
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
            47.5 * (
                1 - (
                    0.18 +
                    (sentenceDensity * 0.09) +
                    (paragraphDensity * 0.085) +
                    (longDraftLoad * 0.065) +
                    (revisionLoad * 0.022) +
                    (intensityBlend * 0.14)
                )
            ),
            metrics.looksStructured ? 22 : 16,
            metrics.looksStructured ? 44 : 38
        );
        const baseTypingMins = (metrics.wordCount / Math.max(1, targetWordsPerMinute)) * proseBias;
        const paragraphMins = metrics.paragraphCount <= 1
            ? 0
            : (metrics.paragraphCount - 1) * interpolateAdaptiveValue(0.6, 1, 1.35, intensityBlend);
        const denseParagraphMins = paragraphDensity * interpolateAdaptiveValue(1.25, 2.35, 3.55, intensityBlend);
        const sentenceMins = Math.max(0, metrics.sentenceCount - 1) *
            interpolateAdaptiveValue(0.075, 0.125, 0.19, intensityBlend);
        const longSentenceMins = sentenceDensity * Math.max(1, metrics.sentenceCount) *
            interpolateAdaptiveValue(0.09, 0.15, 0.24, intensityBlend);
        const punctuationMins = punctuationCount * interpolateAdaptiveValue(0.016, 0.025, 0.036, intensityBlend);
        const revisionMins = revisionLoad * interpolateAdaptiveValue(0.28, 0.42, 0.62, intensityBlend);
        const longDraftMins = longDraftLoad * interpolateAdaptiveValue(2, 3.6, 5.4, intensityBlend);
        const correctionHeadroom = interpolateAdaptiveValue(1.1, 1.2, 1.34, intensityBlend);
        const baselineHeadroomMins = interpolateAdaptiveValue(0.45, 1.5, 2.8, intensityBlend);

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

        const minimumFloor = minimum * interpolateAdaptiveValue(1.08, 1.24, 1.48, intensityBlend);
        const absoluteFloor = minimum + interpolateAdaptiveValue(0.4, 1.8, 3.2, intensityBlend);
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

    function buildCorrectionPreview(metrics, correctionRecommendation = null, selectedIntensity = 'suggested') {
        const selected = normalizeCorrectionIntensity(selectedIntensity);
        const modes = CORRECTION_INTENSITIES.map((mode) => buildCorrectionPreviewForMode(metrics, correctionRecommendation, mode));
        const selectedMode = modes.find((mode) => mode.id === selected) || modes[0];
        const suggestedMode = modes.find((mode) => mode.id === 'suggested') || selectedMode;

        return {
            selected,
            selectedMode,
            suggestedMode,
            modes
        };
    }

    function buildCorrectionPreviewForMode(metrics, correctionRecommendation = null, mode = 'suggested') {
        const normalizedMode = normalizeCorrectionIntensity(mode);
        const hasDraft = Boolean(metrics?.trimmed);
        const intensityBlend = getCorrectionIntensityBlend(normalizedMode, correctionRecommendation);
        const effectiveIntensity = normalizedMode === 'suggested'
            ? getEffectiveIntensityFromBlend(intensityBlend)
            : normalizedMode;
        const adaptiveLabel = normalizedMode === 'suggested'
            ? correctionRecommendation?.label || buildAdaptiveCorrectionLabel(intensityBlend, metrics)
            : formatCorrectionIntensityLabel(effectiveIntensity);

        if (!hasDraft) {
            return {
                id: normalizedMode,
                label: normalizedMode === 'suggested' ? 'Suggested' : formatCorrectionIntensityLabel(normalizedMode),
                effectiveIntensity,
                adaptiveLabel,
                estimatedRepairs: 0,
                delayedRepairs: 0,
                pauseMoments: 0,
                wordLevelRepairs: 0,
                punctuationRepairs: 0,
                spacingRepairs: 0,
                repairDepth: 'none',
                pacingBehavior: 'Add a draft to preview this mode.',
                summary: 'Add a draft to preview this mode.'
            };
        }

        const wordsPerParagraph = metrics.paragraphCount
            ? metrics.wordCount / Math.max(1, metrics.paragraphCount)
            : metrics.wordCount;
        const paragraphDensity = clamp((wordsPerParagraph - 45) / 95, 0, 1.5);
        const sentenceDensity = clamp((metrics.averageSentenceWordCount - 9) / 10, 0, 1.55);
        const longDraftLoad = clamp((metrics.wordCount - 70) / 180, 0, 1.8);
        const punctuationOpportunity = clamp(metrics.punctuationCount / Math.max(1, metrics.sentenceCount || 1), 0, 5);
        const structuredFactor = metrics.looksStructured
            ? interpolateAdaptiveValue(0.48, 0.56, 0.64, intensityBlend)
            : 1;
        const opportunityScore = (
            1.8 +
            Math.sqrt(Math.max(0, metrics.wordCount)) * 0.54 +
            (metrics.sentenceCount * 0.3) +
            (Math.max(0, metrics.paragraphCount - 1) * 0.9) +
            (punctuationOpportunity * 0.44)
        ) * (1 + (paragraphDensity * 0.3) + (sentenceDensity * 0.25) + (longDraftLoad * 0.26)) * structuredFactor;
        const intensityFactor = interpolateAdaptiveValue(0.22, 0.72, 1.55, intensityBlend);
        const floor = getPreviewRepairFloor(metrics, effectiveIntensity, intensityBlend);
        const cap = getPreviewRepairCap(metrics, effectiveIntensity, intensityBlend);
        const estimatedRepairs = Math.min(cap, Math.max(floor, Math.round(opportunityScore * intensityFactor)));
        const delayedRepairs = Math.min(
            estimatedRepairs,
            Math.max(
                estimatedRepairs >= 3 && intensityBlend >= 0.68 ? 1 : 0,
                Math.round(estimatedRepairs * (0.1 + (intensityBlend * 0.42) + (paragraphDensity * 0.08)))
            )
        );
        const pauseMoments = Math.round(
            (metrics.sentenceCount * interpolateAdaptiveValue(0.26, 0.4, 0.58, intensityBlend)) +
            (Math.max(0, metrics.paragraphCount - 1) * interpolateAdaptiveValue(0.74, 1.18, 1.72, intensityBlend)) +
            (estimatedRepairs * interpolateAdaptiveValue(0.38, 0.56, 0.78, intensityBlend))
        );
        const wordLevelRepairs = estimateWordLevelRepairs(metrics, estimatedRepairs, intensityBlend);
        const punctuationRepairs = Math.min(
            estimatedRepairs,
            Math.round(metrics.punctuationCount * interpolateAdaptiveValue(0.024, 0.074, 0.16, intensityBlend))
        );
        const spacingRepairs = Math.min(
            estimatedRepairs,
            Math.round(Math.max(1, metrics.sentenceCount) * interpolateAdaptiveValue(0.055, 0.17, 0.34, intensityBlend))
        );
        const repairDepth = intensityBlend >= 0.86
            ? 'intense'
            : intensityBlend >= 0.68
            ? 'deep'
            : intensityBlend >= 0.42
                ? 'balanced'
                : 'light';
        const pacingBehavior = buildPreviewPacingBehavior(effectiveIntensity, normalizedMode, delayedRepairs, metrics);

        return {
            id: normalizedMode,
            label: normalizedMode === 'suggested' ? 'Suggested' : formatCorrectionIntensityLabel(normalizedMode),
            effectiveIntensity,
            adaptiveLabel,
            estimatedRepairs,
            delayedRepairs,
            pauseMoments,
            wordLevelRepairs,
            punctuationRepairs,
            spacingRepairs,
            repairDepth,
            pacingBehavior,
            summary: buildPreviewSummary(estimatedRepairs, delayedRepairs, pauseMoments, pacingBehavior)
        };
    }

    function getCorrectionIntensityBlend(correctionIntensity, correctionRecommendation = null) {
        const requestedIntensity = normalizeCorrectionIntensity(correctionIntensity);
        if (requestedIntensity === 'high') {
            return 1;
        }
        if (requestedIntensity === 'low') {
            return 0;
        }
        if (requestedIntensity === 'medium') {
            return 0.5;
        }

        if (Number.isFinite(correctionRecommendation?.normalizedScore)) {
            return clamp(correctionRecommendation.normalizedScore, 0, 1);
        }
        if (correctionRecommendation?.intensity === 'high') {
            return 1;
        }
        if (correctionRecommendation?.intensity === 'low') {
            return 0;
        }
        return 0.5;
    }

    function getEffectiveIntensityFromBlend(intensityBlend) {
        if (intensityBlend < 0.34) {
            return 'low';
        }
        if (intensityBlend < 0.68) {
            return 'medium';
        }
        return 'high';
    }

    function getPreviewRepairFloor(metrics, effectiveIntensity, intensityBlend) {
        if (!metrics?.wordCount || metrics.wordCount < 12) {
            return 0;
        }
        if (effectiveIntensity === 'high') {
            if (metrics.wordCount >= 140) {
                return 6;
            }
            if (metrics.wordCount >= 70) {
                return 4;
            }
            return metrics.wordCount >= 28 ? 3 : 1;
        }
        if (effectiveIntensity === 'medium') {
            if (metrics.wordCount >= 120 && intensityBlend >= 0.42) {
                return 3;
            }
            return metrics.wordCount >= 32 && intensityBlend >= 0.42 ? 1 : 0;
        }
        return 0;
    }

    function getPreviewRepairCap(metrics, effectiveIntensity, intensityBlend) {
        const paragraphBonus = Math.max(0, (metrics?.paragraphCount || 0) - 1) * (effectiveIntensity === 'high' ? 3 : effectiveIntensity === 'medium' ? 2 : 1);
        const sentenceBonus = Math.ceil((metrics?.sentenceCount || 0) * interpolateAdaptiveValue(0.12, 0.26, 0.48, intensityBlend));
        const divisor = effectiveIntensity === 'high'
            ? 4
            : effectiveIntensity === 'medium'
                ? 14
                : 34;
        return Math.max(
            getPreviewRepairFloor(metrics, effectiveIntensity, intensityBlend),
            Math.ceil((metrics?.wordCount || 0) / divisor) + paragraphBonus + sentenceBonus
        );
    }

    function estimateWordLevelRepairs(metrics, estimatedRepairs, intensityBlend) {
        if (intensityBlend < 0.42 || estimatedRepairs <= 0 || metrics.looksStructured) {
            return 0;
        }

        const candidateScore = Math.max(0, Math.floor(metrics.wordCount / 65)) +
            (metrics.longWordRatio >= 0.16 ? 1 : 0) +
            (metrics.uniqueWordRatio >= 0.45 && metrics.wordCount >= 70 ? 1 : 0) +
            (metrics.averageWordLength >= 5.2 ? 1 : 0);
        const scaled = Math.round(candidateScore * interpolateAdaptiveValue(0, 0.86, 2.1, intensityBlend));
        return Math.min(estimatedRepairs, Math.max(0, scaled));
    }

    function buildPreviewPacingBehavior(effectiveIntensity, mode, delayedRepairs, metrics) {
        if (metrics.looksStructured && mode !== 'high') {
            return 'careful spacing around structured text';
        }
        if (effectiveIntensity === 'high') {
            return delayedRepairs > 0
                ? 'intense repairs with later cleanup windows'
                : 'intense repairs with deeper backtracking';
        }
        if (effectiveIntensity === 'low') {
            return 'rare corrections with wider spacing';
        }
        return delayedRepairs > 0
            ? 'balanced repairs with a few delayed cleanups'
            : 'balanced repairs with steady pacing';
    }

    function buildPreviewSummary(estimatedRepairs, delayedRepairs, pauseMoments, pacingBehavior) {
        const repairLabel = estimatedRepairs === 1 ? '1 repair' : `${estimatedRepairs} repairs`;
        const delayedLabel = delayedRepairs === 1 ? '1 delayed' : `${delayedRepairs} delayed`;
        const pauseLabel = pauseMoments === 1 ? '1 pause point' : `${pauseMoments} pause points`;
        return `${repairLabel}, ${delayedLabel}, ${pauseLabel}; ${pacingBehavior}.`;
    }

    function formatCorrectionIntensityLabel(value) {
        const normalized = normalizeCorrectionIntensity(value);
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
        let normalized = clamp((Number(score) + 0.7) / 5.4, 0, 1);
        if (metrics?.looksStructured) {
            normalized *= 0.78;
        }
        if ((metrics?.paragraphCount || 0) >= 3 && (metrics?.wordCount || 0) >= 120) {
            normalized = Math.max(normalized, 0.46);
        }
        if ((metrics?.wordCount || 0) >= 220 && !metrics?.looksStructured) {
            normalized = Math.max(normalized, 0.6);
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
        if (normalizedScore < 0.9) {
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
        KEEP_AWAKE_ENABLED_KEY,
        CORRECTION_INTENSITIES,
        RECOVERABLE_ATTENTION_CODES,
        normalizeCorrectionIntensity,
        sanitizeDraftText,
        estimateMinimumDurationSeconds,
        getMinimumDurationMins,
        normalizeDurationMins,
        analyzeDraftText,
        suggestCorrectionIntensity,
        buildCorrectionPreview
    });
}());
