interface LogFields {
  [key: string]: unknown
}

const stringify = (event: string, fields: LogFields): string => {
  try {
    return JSON.stringify({ event, ...fields })
  } catch (error) {
    return JSON.stringify({ event, message: 'failed_to_stringify', original: String(error) })
  }
}

export const logInfo = (event: string, fields: LogFields = {}): void => {
  console.log(stringify(event, fields))
}

export const logError = (event: string, fields: LogFields = {}): void => {
  console.error(stringify(event, fields))
}
