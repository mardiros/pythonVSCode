'use strict';
import * as vscode from 'vscode';
import { Tests, CANCELLATION_REASON } from '../common/contracts';
import * as constants from '../../common/constants';
import { displayTestErrorMessage } from '../common/testUtils';
import { isNotInstalledError } from '../../common/helpers';

export class TestResultDisplay {
    private statusBar: vscode.StatusBarItem;
    constructor(private outputChannel: vscode.OutputChannel) {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    }
    public dispose() {
        this.statusBar.dispose();
    }
    public set enabled(enable: boolean) {
        if (enable) {
            this.statusBar.show();
        }
        else {
            this.statusBar.hide();
        }
    }
    public DisplayProgressStatus(tests: Promise<Tests>) {
        this.displayProgress('Running Tests', `Running Tests (Click to Stop)`, constants.Commands.Tests_Ask_To_Stop_Test);
        tests
            .then(this.updateTestRunWithSuccess.bind(this))
            .catch(this.updateTestRunWithFailure.bind(this))
            // We don't care about any other exceptions returned by updateTestRunWithFailure
            .catch(() => { });
    }

    private updateTestRunWithSuccess(tests: Tests): Tests {
        this.clearProgressTicker();

        // Treat errors as a special case, as we generally wouldn't have any errors
        const statusText = [];
        const toolTip = [];
        let foreColor = '';

        if (tests.summary.passed > 0) {
            statusText.push(`${constants.Octicons.Test_Pass} ${tests.summary.passed}`);
            toolTip.push(`${tests.summary.passed} Passed`);
            foreColor = '#66ff66';
        }
        if (tests.summary.skipped > 0) {
            statusText.push(`${constants.Octicons.Test_Skip} ${tests.summary.skipped}`);
            toolTip.push(`${tests.summary.skipped} Skipped`);
            foreColor = '#66ff66';
        }
        if (tests.summary.failures > 0) {
            statusText.push(`${constants.Octicons.Test_Fail} ${tests.summary.failures}`);
            toolTip.push(`${tests.summary.failures} Failed`);
            foreColor = 'yellow';
        }
        if (tests.summary.errors > 0) {
            statusText.push(`${constants.Octicons.Test_Error} ${tests.summary.errors}`);
            toolTip.push(`${tests.summary.errors} Error${tests.summary.errors > 1 ? 's' : ''}`);
            foreColor = 'yellow';
        }
        this.statusBar.tooltip = toolTip.length === 0 ? 'No Tests Ran' : toolTip.join(', ') + ' (Tests)';
        this.statusBar.text = statusText.length === 0 ? 'No Tests Ran' : statusText.join(' ');
        this.statusBar.color = foreColor;
        this.statusBar.command = constants.Commands.Tests_View_UI;
        return tests;
    }

    private updateTestRunWithFailure(reason: any): Promise<any> {
        this.clearProgressTicker();
        this.statusBar.command = constants.Commands.Tests_View_UI;
        if (reason === CANCELLATION_REASON) {
            this.statusBar.text = '$(zap) Run Tests';
            this.statusBar.tooltip = 'Run Tests';
        }
        else {
            this.statusBar.text = `$(alert) Tests Failed`;
            this.statusBar.tooltip = 'Running Tests Failed';
            displayTestErrorMessage('There was an error in running the tests.');
        }
        return Promise.reject(reason);
    }

    private discoverCounter = 0;
    private ticker = ['|', '/', '-', '|', '/', '-', '\\'];
    private progressTimeout;
    private progressPrefix: string;
    private displayProgress(message: string, tooltip: string, command: string) {
        this.progressPrefix = this.statusBar.text = '$(stop) ' + message;
        this.statusBar.command = command;
        this.statusBar.tooltip = tooltip;
        this.statusBar.show();
        this.clearProgressTicker();
        this.progressTimeout = setInterval(() => this.updateProgressTicker(), 150);
    }
    private updateProgressTicker() {
        let text = `${this.progressPrefix} ${this.ticker[this.discoverCounter % 7]}`;
        this.discoverCounter += 1;
        this.statusBar.text = text;
    }
    private clearProgressTicker() {
        if (this.progressTimeout) {
            clearInterval(this.progressTimeout);
        }
        this.progressTimeout = null;
        this.discoverCounter = 0;
    }

    public DisplayDiscoverStatus(tests: Promise<Tests>, quietMode: boolean = false) {
        this.displayProgress('Discovering Tests', 'Discovering Tests (Click to Stop)', constants.Commands.Tests_Ask_To_Stop_Discovery);
        return tests.then(tests => {
            this.updateWithDiscoverSuccess(tests);
            return tests;
        }).catch(reason => {
            this.updateWithDiscoverFailure(reason, quietMode);
            return Promise.reject(reason);
        });
    }

    private updateWithDiscoverSuccess(tests: Tests) {
        this.clearProgressTicker();
        const haveTests = tests && (tests.testFunctions.length > 0);
        this.statusBar.text = haveTests ? '$(zap) Run Tests' : 'No Tests';
        this.statusBar.tooltip = haveTests ? 'Run Tests' : 'No Tests discovered';
        this.statusBar.command = haveTests ? constants.Commands.Tests_View_UI : constants.Commands.Tests_Discover;
        this.statusBar.show();
    }

    private updateWithDiscoverFailure(reason: any, quietMode: boolean = false) {
        this.clearProgressTicker();
        this.statusBar.text = `$(zap) Discover Tests`;
        this.statusBar.tooltip = 'Discover Tests';
        this.statusBar.command = constants.Commands.Tests_Discover;
        this.statusBar.show();
        this.statusBar.color = 'yellow';
        if (reason !== CANCELLATION_REASON) {
            this.statusBar.text = `$(alert) Test discovery failed`;
            this.statusBar.tooltip = `Discovering Tests failed (view 'Python Test Log' output panel for details)`;
            if (!isNotInstalledError(reason) && !quietMode) {
                vscode.window.showErrorMessage('There was an error in discovering tests');
            }
        }
    }
}