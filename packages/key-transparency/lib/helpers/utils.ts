import { sub } from 'date-fns';

import { serverTime } from '@proton/crypto';
import { TelemetryKeyTransparencyErrorEvents, TelemetryMeasurementGroups } from '@proton/shared/lib/api/telemetry';
import { PROTON_DOMAINS } from '@proton/shared/lib/constants';
import { sendTelemetryReport } from '@proton/shared/lib/helpers/metrics';
import { captureMessage } from '@proton/shared/lib/helpers/sentry';
import { Api } from '@proton/shared/lib/interfaces';

import { EXPECTED_EPOCH_INTERVAL, KT_DOMAINS, MAX_EPOCH_INTERVAL } from '../constants/constants';

/**
 * Retrieve when an obsolescence token was generated by parsing
 * from the token itself
 */
export const getTimeFromObsolescenceToken = (ObsolescenceToken: string) => parseInt(ObsolescenceToken.slice(0, 16), 16);

/**
 * Extract the domain from an email address
 */
export const getEmailDomain = (email: string) => `@${email.split('@')[1]}`;

/**
 * Check whether a timestamp is older than maximum epoch interval from the given reference
 */
export const isTimestampTooOlderThanReference = (time: number, referenceTime: number) =>
    referenceTime > MAX_EPOCH_INTERVAL + time;

/**
 * Check whether a timestamp is older than maximum epoch interval from now
 */
export const isTimestampTooOld = (time: number) => isTimestampTooOlderThanReference(time, +serverTime());

/**
 * Check whether a timestamp is within a maximum epoch interval range
 * from the given temporal reference, boundaries included
 */
export const isTimestampWithinSingleRange = (time: number, referenceTime: number) =>
    Math.abs(referenceTime - time) <= MAX_EPOCH_INTERVAL;

/**
 * Check whether a timestamp is within two limits, boundaries included
 */
export const isTimestampWithinDoubleRange = (time: number, start: number, end: number) => time >= start && time <= end;

/**
 * Check whether a timestamp is within a maximum epoch interval range from
 * 90 days in the past, which is the threshold after which epoch certificates
 * expire
 */
export const isTimestampOldEnough = (time: number) =>
    isTimestampWithinSingleRange(time, +sub(serverTime(), { days: 90 }));

/**
 * Check whether a timestamp is older than 90 days in the past,
 * which is the threshold after which epoch certificates expire
 */
export const isTimestampOlderThanThreshold = (time: number) => time < +sub(serverTime(), { days: 90 });

/**
 * Helper to send outbound public key verification failures to the telemetry endpoint
 */
export const ktKeyVerificationFailureTelemetry = (api: Api): Promise<void> => {
    return sendTelemetryReport({
        api,
        measurementGroup: TelemetryMeasurementGroups.keyTransparency,
        event: TelemetryKeyTransparencyErrorEvents.key_verification_failure,
    });
};

/**
 * Helper to send KT-related sentry reports
 */
export const ktSentryReport = (errorMessage: string, extra?: { [key: string]: any }) => {
    const isoServerTime = serverTime().toISOString();
    const extraWithServerTime = { ...extra, server_time: isoServerTime };
    captureMessage(`[KeyTransparency] ${errorMessage}`, { extra: extraWithServerTime });
};

/**
 * Helper to send KT-related sentry reports
 */
export const ktSentryReportError = (error: any, extra?: { [key: string]: any }) => {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    ktSentryReport(errorMessage, { ...extra, stack });
};

export class KeyTransparencyError extends Error {}

export class StaleEpochError extends Error {}

export const throwKTError = (errorMessage: string, extra?: { [key: string]: any }): never => {
    ktSentryReport(errorMessage, extra);
    throw new KeyTransparencyError(errorMessage);
};

/**
 * Derive which base domain is being used, whether production or test
 */
export const getBaseDomain = (sendReport: boolean = true) => {
    // The app name is removed
    const { hostname } = window.location;
    const currentDomain = hostname.slice(hostname.indexOf('.') + 1);

    // Production domain, e.g. protonmail.com -> PROD
    if (PROTON_DOMAINS.includes(currentDomain)) {
        return KT_DOMAINS.PROD;
    }

    // Development or test environments
    const domainParts = currentDomain.split('.');
    if (domainParts.length > 1 && domainParts[domainParts.length - 2] === 'proton') {
        const postfix = domainParts[domainParts.length - 1];
        switch (postfix) {
            case 'pink':
                // {env}.proton.pink -> prod
                return KT_DOMAINS.PROD;
            case 'black':
                if (domainParts.length < 3) {
                    // proton.black -> ATLAS_DEV
                    return KT_DOMAINS.ATLAS_DEV;
                } else {
                    // {env}.proton.black -> {env} + DEV_POSTFIX
                    return domainParts[domainParts.length - 3] + KT_DOMAINS.DEV_POSTFIX;
                }
            case 'local':
                // proton.local -> ATLAS_DEV
                return KT_DOMAINS.ATLAS_DEV;
        }
    }

    // Any other domain.
    // Since this function is also used to test whether to use KT at all, we don't want to spam sentry with
    // attempts to figure this out, in which case sendReport should be false
    if (sendReport) {
        return throwKTError('Domain not recognised', {
            hostname,
            currentDomain,
            domainParts: JSON.stringify(domainParts),
        });
    }

    return KT_DOMAINS.UNKNOWN;
};

export const getSelfAuditInterval = () => {
    return EXPECTED_EPOCH_INTERVAL;
};
