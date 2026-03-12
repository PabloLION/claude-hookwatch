/**
 * Named HTTP status code constants for the hookwatch server.
 *
 * Centralised here so every server module uses the same names instead
 * of repeating raw numbers that SonarQube flags as magic numbers (S109).
 */

export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_SERVICE_UNAVAILABLE = 503;
