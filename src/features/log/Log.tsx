const Log = () => {
    const logs: Array<any> = [];
    return <div>
        {logs.map(log => {
            return <div key={log}>{log}</div>
        })}
    </div>
}

export default Log;