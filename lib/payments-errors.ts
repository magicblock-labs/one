export function getPaymentsErrorMessage(
  status: number,
  responseBody: unknown
) {
  if (responseBody && typeof responseBody === "object") {
    const maybeError = "error" in responseBody ? responseBody.error : undefined;
    if (maybeError && typeof maybeError === "object" && "message" in maybeError) {
      const message = maybeError.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }

    const maybeMessage = "message" in responseBody ? responseBody.message : undefined;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  return `Payments API error: ${status}`;
}
