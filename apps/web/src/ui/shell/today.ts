export const dayNumber = (date: Date) =>
  date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
