

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuid } from 'uuid';

export type LogType = 'battle' | 'warning';

export interface Log {
    id: string,
    type: LogType,
    content?: string,
    time: number
}

interface LogState {
    logs: Array<Log>
}

const initialState: LogState = {
    logs: []
}

const logSlice = createSlice({
    name: 'log',
    initialState,
    reducers: {
        addLog: (state, { payload }: PayloadAction<{
            type: LogType,
            content: string,
            time: number
        }>) => {
            state.logs.push({
                id: uuid(),
                ...payload,
            });
        }
    }
})

export const { addLog } = logSlice.actions
export default logSlice.reducer