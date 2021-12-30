import dayjs from 'dayjs';

const timeShorter = (value: number, toSecond: boolean = true) => {
    if (isNaN(value)) {
        return undefined
    }

    if (value === 0) {
        return `0秒`
    }

    const t = dayjs.duration(value);
    const hours = t.hours();
    const minutes = t.minutes();
    let result = `${hours ? `${hours}小时` : ''} ${minutes ? `${minutes}分` : ''}`;
    if (toSecond) {
        result = `${result} ${t.seconds() || '0'}秒`
    }
    return result;
}

export { timeShorter }