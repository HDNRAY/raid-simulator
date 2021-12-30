import { useEffect, useRef } from "react";
import { Log } from "redux/log";
import { useAppSelector } from "redux/store";
import './Logs.scss';

const Logs = (props: {
    className?: string
}) => {
    const { className } = props;
    const logs: Array<Log> = useAppSelector(state => state.log.logs);

    const logsWrapper = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (logsWrapper.current) {
            logsWrapper.current.scrollTop = logsWrapper.current?.scrollHeight;
        }
    }, [logs]);

    return <div className={`logs-wrapper ${className}`} ref={logsWrapper}>
        {logs.map(log => {
            return <div className={`log-wrapper ${log.type}`} key={log.id}>{log.content}</div>
        })}
    </div>
}

export default Logs;