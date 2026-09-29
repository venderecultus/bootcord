type NotificationType = 'microphone' | 'network' | 'voice' | 'general';

let notify: (message: string, details: string, type: NotificationType) => void = () => {};

export function setErrorNotificationHandler(handler: typeof notify): void {
    notify = handler;
}

export function sendErrorNotification(message: string, details: string, type: NotificationType = 'general'): void {
    notify(message, details, type);
}
