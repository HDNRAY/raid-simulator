

import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuid } from 'uuid';

export interface Log {
    id: string,
    type: 'battle' | 'warning',
    content: string
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
        addLog: (state, { payload }) => {
            state.logs.push({
                id: uuid(),
                ...payload
            });
        }
    }
})

export const { addLog } = logSlice.actions
export default logSlice.reducer