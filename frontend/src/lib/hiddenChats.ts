// Диалоги, которые человек скрыл у себя в списке. Нужны для чатов, которые сервер удалить не даёт (по плану оформлена заявка):
// удалить нельзя, но убрать из списка можно. Скрытие хранится в этом браузере.
const KEY = 'xronix_hidden_chats'
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] } }
export const hideChat = (id: string) => { const list = read(); if (!list.includes(id)) { try { localStorage.setItem(KEY, JSON.stringify([...list, id])) } catch { /* хранилище недоступно */ } } }
export const isHiddenChat = (id: string) => read().includes(id)
