export function getPromptTextFromChat(chat) {
    if (!Array.isArray(chat)) return '';

    return chat
        .map((message) => {
            if (typeof message?.content === 'string') return message.content;
            if (typeof message?.mes === 'string') return message.mes;
            return '';
        })
        .filter(Boolean)
        .join('\n\n');
}
