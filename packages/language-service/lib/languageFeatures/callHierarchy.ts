import type * as vscode from 'vscode-languageserver-protocol';
import type { ServiceContext } from '../types';
import { notEmpty } from '../utils/common';
import * as dedupe from '../utils/dedupe';
import { languageFeatureWorker } from '../utils/featureWorkers';
import { NoneCancellationToken } from '../utils/cancellation';

export interface PluginCallHierarchyData {
	uri: string,
	original: Pick<vscode.CallHierarchyItem, 'data'>,
	serviceIndex: number,
	virtualDocumentUri: string | undefined,
}

export function register(context: ServiceContext) {

	return {

		doPrepare(uri: string, position: vscode.Position, token = NoneCancellationToken) {

			return languageFeatureWorker(
				context,
				uri,
				position,
				(position, map) => map.toGeneratedPositions(position, data => !!data.references),
				async (service, document, position, map) => {

					if (token.isCancellationRequested)
						return;

					const items = await service.provideCallHierarchyItems?.(document, position, token);

					items?.forEach(item => {
						item.data = {
							uri,
							original: {
								data: item.data,
							},
							serviceIndex: context.services.indexOf(service),
							virtualDocumentUri: map?.virtualFileDocument.uri,
						} satisfies PluginCallHierarchyData;
					});

					return items;
				},
				(data, sourceMap) => !sourceMap ? data : data
					.map(item => transformCallHierarchyItem(item, [])?.[0])
					.filter(notEmpty),
				arr => dedupe.withLocations(arr.flat()),
			);
		},

		async getIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken) {

			const data: PluginCallHierarchyData | undefined = item.data;
			let incomingItems: vscode.CallHierarchyIncomingCall[] = [];

			if (data) {

				const service = context.services[data.serviceIndex];

				if (!service.provideCallHierarchyIncomingCalls)
					return incomingItems;

				Object.assign(item, data.original);

				if (data.virtualDocumentUri) {

					const [virtualFile] = context.project.fileProvider.getVirtualFile(data.virtualDocumentUri);

					if (virtualFile) {

						const _calls = await service.provideCallHierarchyIncomingCalls(item, token);

						for (const _call of _calls) {

							const calls = transformCallHierarchyItem(_call.from, _call.fromRanges);

							if (!calls)
								continue;

							incomingItems.push({
								from: calls[0],
								fromRanges: calls[1],
							});
						}
					}
				}
				else {

					const _calls = await service.provideCallHierarchyIncomingCalls(item, token);

					for (const _call of _calls) {

						const calls = transformCallHierarchyItem(_call.from, _call.fromRanges);

						if (!calls)
							continue;

						incomingItems.push({
							from: calls[0],
							fromRanges: calls[1],
						});
					}
				}
			}

			return dedupe.withCallHierarchyIncomingCalls(incomingItems);
		},

		async getOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken) {

			const data: PluginCallHierarchyData | undefined = item.data;
			let items: vscode.CallHierarchyOutgoingCall[] = [];

			if (data) {

				const service = context.services[data.serviceIndex];

				if (!service.provideCallHierarchyOutgoingCalls)
					return items;

				Object.assign(item, data.original);

				if (data.virtualDocumentUri) {

					const [virtualFile] = context.project.fileProvider.getVirtualFile(data.virtualDocumentUri);

					if (virtualFile) {

						const _calls = await service.provideCallHierarchyOutgoingCalls(item, token);

						for (const call of _calls) {

							const calls = transformCallHierarchyItem(call.to, call.fromRanges);

							if (!calls)
								continue;

							items.push({
								to: calls[0],
								fromRanges: calls[1],
							});
						}
					}
				}
				else {

					const _calls = await service.provideCallHierarchyOutgoingCalls(item, token);

					for (const call of _calls) {

						const calls = transformCallHierarchyItem(call.to, call.fromRanges);

						if (!calls)
							continue;

						items.push({
							to: calls[0],
							fromRanges: calls[1],
						});
					}
				}
			}

			return dedupe.withCallHierarchyOutgoingCalls(items);
		},
	};

	function transformCallHierarchyItem(tsItem: vscode.CallHierarchyItem, tsRanges: vscode.Range[]): [vscode.CallHierarchyItem, vscode.Range[]] | undefined {

		const [virtualFile] = context.project.fileProvider.getVirtualFile(tsItem.uri);

		if (!virtualFile)
			return [tsItem, tsRanges];

		for (const map of context.documents.getMapsByVirtualFile(virtualFile)) {

			let range = map.toSourceRange(tsItem.range);
			if (!range) {
				// TODO: <script> range
				range = {
					start: map.sourceFileDocument.positionAt(0),
					end: map.sourceFileDocument.positionAt(map.sourceFileDocument.getText().length),
				};
			}

			const selectionRange = map.toSourceRange(tsItem.selectionRange);
			if (!selectionRange)
				continue;

			const vueRanges = tsRanges.map(tsRange => map.toSourceRange(tsRange)).filter(notEmpty);
			const vueItem: vscode.CallHierarchyItem = {
				...tsItem,
				name: tsItem.name === map.virtualFileDocument.uri.substring(map.virtualFileDocument.uri.lastIndexOf('/') + 1)
					? map.sourceFileDocument.uri.substring(map.sourceFileDocument.uri.lastIndexOf('/') + 1)
					: tsItem.name,
				uri: map.sourceFileDocument.uri,
				// TS Bug: `range: range` not works
				range: {
					start: range.start,
					end: range.end,
				},
				selectionRange: {
					start: selectionRange.start,
					end: selectionRange.end,
				},
			};

			selectionRange.end;

			return [vueItem, vueRanges];
		}
	}
}