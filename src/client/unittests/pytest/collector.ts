'use strict';
import {execPythonFile} from './../../common/utils';
import {TestFile, TestsToRun, TestSuite, TestFunction, FlattenedTestFunction, Tests, TestStatus, FlattenedTestSuite} from '../common/contracts';
import * as os from 'os';
import {extractBetweenDelimiters, flattenTestFiles, updateResults, convertFileToPackage} from '../common/testUtils';
import * as vscode from 'vscode';
import * as path from 'path';
import {PythonSettings} from '../../common/configSettings';

const pythonSettings = PythonSettings.getInstance();

const argsToExcludeForDiscovery = ['--lf', '--last-failed', '--markers', '-x',
    '--exitfirst', '--maxfail', '--fixtures', '--funcargs', '-pdb', '--capture',
    '-s', ' --runxfail', ' --ff', '--failed-first', '--cache-show', '--cache-clear',
    '-v', '--verbose', '-q', '-quiet', '-r ', '--report', '--tb', '--color',
    '--durations', '--pastebin', '--junit-xml=path', '--junit-prefix',
    '--result-log', '--version', '-h', '--help', '--debug'];
const settingsInArgsToExcludeForDiscovery = ['--maxfail', '--capture',
    '-r ', '--report', '--tb', '--color', '--durations', '--pastebin',
    '--junit-xml=path', '--junit-prefix', '--result-log'];

export function discoverTests(rootDirectory: string, args: string[], token: vscode.CancellationToken, ignoreCache: boolean): Promise<Tests> {
    let logOutputLines: string[] = [''];
    let testFiles: TestFile[] = [];
    let parentNodes: { indent: number, item: TestFile | TestSuite }[] = [];
    let collectionCountReported = false;
    const errorLine = /==*( *)ERRORS( *)=*/;
    const errorFileLine = /__*( *)ERROR collecting (.*)/;
    const lastLineWithErrors = /==*.*/;
    let haveErrors = false;

    // Remove unwanted arguments
    args = args.filter(arg => {
        if (argsToExcludeForDiscovery.indexOf(arg.trim()) !== -1) {
            return false;
        }
        if (settingsInArgsToExcludeForDiscovery.some(setting => setting.indexOf(arg.trim()) === 0)) {
            return false;
        }
        return true;
    });
    if (ignoreCache && args.indexOf('--cache-clear') === -1) {
        args.push('--cache-clear');
    }
    function processOutput(output: string) {
        output.split(/\r?\n/g).forEach((line, index, lines) => {
            if (token && token.isCancellationRequested) {
                return;
            }
            if (line.trim().startsWith('<Module \'')) {
                // process the previous lines
                parsePyTestModuleCollectionResult(rootDirectory, logOutputLines, testFiles, parentNodes);
                logOutputLines = [''];
            }
            if (errorLine.test(line)) {
                haveErrors = true;
                logOutputLines = [''];
                return;
            }
            if (errorFileLine.test(line)) {
                haveErrors = true;
                if (logOutputLines.length !== 1 && logOutputLines[0].length !== 0) {
                    parsePyTestModuleCollectionError(rootDirectory, logOutputLines, testFiles, parentNodes);
                    logOutputLines = [''];
                }
            }
            if (lastLineWithErrors.test(line) && haveErrors) {
                parsePyTestModuleCollectionError(rootDirectory, logOutputLines, testFiles, parentNodes);
                logOutputLines = [''];
            }
            if (index === 0) {
                if (output.startsWith(os.EOL) || lines.length > 1) {
                    logOutputLines[logOutputLines.length - 1] += line;
                    logOutputLines.push('');
                    return;
                }
                logOutputLines[logOutputLines.length - 1] += line;
                return;
            }
            if (index === lines.length - 1) {
                logOutputLines[logOutputLines.length - 1] += line;
                return;
            }
            logOutputLines[logOutputLines.length - 1] += line;
            logOutputLines.push('');
            return;
        });
    }

    return execPythonFile(pythonSettings.unitTest.pyTestPath, args.concat(['--collect-only']), rootDirectory, false, null, token)
        .then(data => {
            processOutput(data);
            if (token && token.isCancellationRequested) {
                return Promise.reject<Tests>('cancelled');
            }
            return flattenTestFiles(testFiles);
        });
}

const DELIMITER = '\'';
const DEFAULT_CLASS_INDENT = 2;

function parsePyTestModuleCollectionError(rootDirectory: string, lines: string[], testFiles: TestFile[],
    parentNodes: { indent: number, item: TestFile | TestSuite }[]) {

    lines = lines.filter(line => line.trim().length > 0);
    if (lines.length <= 1) {
        return;
    }

    let errorFileLine = lines[0];
    let fileName = errorFileLine.substring(errorFileLine.indexOf('ERROR collecting') + 'ERROR collecting'.length).trim();
    fileName = fileName.substr(0, fileName.lastIndexOf(' '));

    const currentPackage = convertFileToPackage(fileName);
    const fullyQualifiedName = path.isAbsolute(fileName) ? fileName : path.resolve(rootDirectory, fileName);
    const testFile = {
        functions: [], suites: [], name: fileName, fullPath: fullyQualifiedName,
        nameToRun: fileName, xmlName: currentPackage, time: 0, errorsWhenDiscovering: lines.join('\n')
    };
    testFiles.push(testFile);
    parentNodes.push({ indent: 0, item: testFile });

    return;

}
function parsePyTestModuleCollectionResult(rootDirectory: string, lines: string[], testFiles: TestFile[], parentNodes: { indent: number, item: TestFile | TestSuite }[]) {
    let currentPackage: string = '';

    lines.forEach(line => {
        const trimmedLine = line.trim();
        const name = extractBetweenDelimiters(trimmedLine, DELIMITER, DELIMITER);
        const indent = line.indexOf('<');

        if (trimmedLine.startsWith('<Module \'')) {
            currentPackage = convertFileToPackage(name);
            const fullyQualifiedName = path.isAbsolute(name) ? name : path.resolve(rootDirectory, name);
            const testFile = {
                functions: [], suites: [], name: name, fullPath: fullyQualifiedName,
                nameToRun: name, xmlName: currentPackage, time: 0
            };
            testFiles.push(testFile);
            parentNodes.push({ indent: indent, item: testFile });
            return;
        }

        const parentNode = findParentOfCurrentItem(indent, parentNodes);

        if (trimmedLine.startsWith('<Class \'') || trimmedLine.startsWith('<UnitTestCase \'')) {
            const isUnitTest = trimmedLine.startsWith('<UnitTestCase \'');
            const rawName = parentNode.item.nameToRun + `::${name}`;
            const xmlName = parentNode.item.xmlName + `.${name}`;
            const testSuite: TestSuite = { name: name, nameToRun: rawName, functions: [], suites: [], isUnitTest: isUnitTest, isInstance: false, xmlName: xmlName, time: 0 };
            parentNode.item.suites.push(testSuite);
            parentNodes.push({ indent: indent, item: testSuite });
            return;
        }
        if (trimmedLine.startsWith('<Instance \'')) {
            let suite = (parentNode.item as TestSuite);
            // suite.rawName = suite.rawName + '::()';
            // suite.xmlName = suite.xmlName + '.()';
            suite.isInstance = true;
            return;
        }
        if (trimmedLine.startsWith('<TestCaseFunction \'') || trimmedLine.startsWith('<Function \'')) {
            const rawName = parentNode.item.nameToRun + '::' + name;
            const fn: TestFunction = { name: name, nameToRun: rawName, time: 0 };
            parentNode.item.functions.push(fn);
            return;
        }
    });
}

function findParentOfCurrentItem(indentOfCurrentItem: number, parentNodes: { indent: number, item: TestFile | TestSuite }[]): { indent: number, item: TestFile | TestSuite } {
    while (parentNodes.length > 0) {
        let parentNode = parentNodes[parentNodes.length - 1];
        if (parentNode.indent < indentOfCurrentItem) {
            return parentNode;
        }
        parentNodes.pop();
        continue;
    }

    return null;
}

/* Sample output from py.test --collect-only
<Module 'test_another.py'>
  <Class 'Test_CheckMyApp'>
    <Instance '()'>
      <Function 'test_simple_check'>
      <Function 'test_complex_check'>
<Module 'test_one.py'>
  <UnitTestCase 'Test_test1'>
    <TestCaseFunction 'test_A'>
    <TestCaseFunction 'test_B'>
<Module 'test_two.py'>
  <UnitTestCase 'Test_test1'>
    <TestCaseFunction 'test_A2'>
    <TestCaseFunction 'test_B2'>
<Module 'testPasswords/test_Pwd.py'>
  <UnitTestCase 'Test_Pwd'>
    <TestCaseFunction 'test_APwd'>
    <TestCaseFunction 'test_BPwd'>
<Module 'testPasswords/test_multi.py'>
  <Class 'Test_CheckMyApp'>
    <Instance '()'>
      <Function 'test_simple_check'>
      <Function 'test_complex_check'>
      <Class 'Test_NestedClassA'>
        <Instance '()'>
          <Function 'test_nested_class_methodB'>
          <Class 'Test_nested_classB_Of_A'>
            <Instance '()'>
              <Function 'test_d'>
  <Function 'test_username'>
  <Function 'test_parametrized_username[one]'>
  <Function 'test_parametrized_username[two]'>
  <Function 'test_parametrized_username[three]'>
*/
