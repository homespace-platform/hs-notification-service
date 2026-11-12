export const ErrorCode = {
  UNCATEGORIZED_EXCEPTION: {
    code: 9999,
    message: 'Uncategorized error',
    statusCode: 500,
  },
  UNAUTHENTICATED: {
    code: 1002,
    message: 'Unauthenticated',
    statusCode: 401,
  },
  UNAUTHORIZED: {
    code: 1003,
    message: 'You do not have permission',
    statusCode: 403,
  },
  ROUTE_NOT_FOUND: {
    code: 1012,
    message: 'Route not found',
    statusCode: 404,
  },
  NOTIFICATION_NOT_FOUND: {
    code: 4101,
    message: 'Notification not found',
    statusCode: 404,
  },
  INVALID_CURSOR: {
    code: 4102,
    message: 'Invalid cursor',
    statusCode: 400,
  },
  INVALID_PREFERENCES: {
    code: 4103,
    message: 'Invalid notification preferences',
    statusCode: 400,
  },
} as const;

export type ErrorDefinition = (typeof ErrorCode)[keyof typeof ErrorCode];
