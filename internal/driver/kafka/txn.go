package kafka

import (
	"context"
	"sort"
	"strconv"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Transactions, and why a console shows them at all.
 *
 * A transaction that is Ongoing holds the last stable offset of every
 * partition it has written to, and a consumer reading committed records will
 * not advance past it. One producer that died mid-transaction can stall an
 * entire pipeline while every other figure on every other page looks perfectly
 * healthy - the topic has records, the group has lag, nothing is
 * under-replicated, and the consumer is simply not being given anything.
 *
 * This panel is the only place in the app where that is visible.
 */

// Transaction states Kafka reports. Two of them mean somebody is waiting.
const (
	txnOngoing       = "Ongoing"
	txnPrepareCommit = "PrepareCommit"
	txnPrepareAbort  = "PrepareAbort"
)

// ListTransactions reports every transactional producer the cluster knows of.
//
// Listed first, then described: the list carries the id and the state, and
// only the describe knows which partitions are held and when the transaction
// began - which is what turns "there is a transaction" into "this is what it
// is holding up".
func (c *Conn) ListTransactions(ctx context.Context) ([]*model.Transaction, error) {
	listed, err := c.admin.ListTransactions(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	if len(listed) == 0 {
		return []*model.Transaction{}, nil
	}

	ids := make([]string, 0, len(listed))
	for _, one := range listed.Sorted() {
		ids = append(ids, one.TxnID)
	}

	// A describe that fails costs the detail, not the listing: knowing a
	// transaction exists is most of the value.
	described, _ := c.admin.DescribeTransactions(ctx, ids...)

	transactions := make([]*model.Transaction, 0, len(ids))
	for _, one := range listed.Sorted() {
		transactions = append(transactions, transactionFrom(one, described[one.TxnID]))
	}
	return transactions, nil
}

func transactionFrom(
	listed kadm.ListedTransaction, described kadm.DescribedTransaction,
) *model.Transaction {
	transaction := &model.Transaction{
		ID:          listed.TxnID,
		State:       listed.State,
		Coordinator: listed.Coordinator,
		ProducerID:  listed.ProducerID,
		// Unknown until the describe fills it in: a zero timestamp would read
		// as 1970 rather than as "the coordinator did not say".
		StartedAt:  model.UnknownMetric,
		Partitions: []string{},
	}
	if described.Err != nil || described.TxnID == "" {
		transaction.Open = TransactionIsOpen(transaction)
		transaction.Holding = TransactionIsHolding(transaction)
		return transaction
	}

	transaction.ProducerEpoch = described.ProducerEpoch
	transaction.TimeoutMs = described.TimeoutMillis
	if described.StartTimestamp > 0 {
		transaction.StartedAt = described.StartTimestamp
	}
	// A describe is the fresher answer: a transaction can move between the
	// list and the describe, and the second one is the later view.
	if described.State != "" {
		transaction.State = described.State
	}
	transaction.Partitions = partitionLabels(described.Topics)
	transaction.Open = TransactionIsOpen(transaction)
	transaction.Holding = TransactionIsHolding(transaction)
	return transaction
}

// partitionLabels is what a transaction is holding, as topic:partition pairs.
func partitionLabels(topics kadm.TopicsSet) []string {
	labels := make([]string, 0)
	for topic, partitions := range topics {
		for partition := range partitions {
			labels = append(labels, topic+":"+strconv.FormatInt(int64(partition), 10))
		}
	}
	sort.Strings(labels)
	return labels
}

// TransactionIsHolding reports whether this transaction is stopping a consumer
// from advancing - which is the only reason the panel exists.
//
// Ongoing is the obvious case. The two prepare states count too: the
// coordinator has decided and is still writing markers, and until it finishes
// the partitions without one are as unreadable as they were before.
func TransactionIsHolding(transaction *model.Transaction) bool {
	return TransactionIsOpen(transaction) && len(transaction.Partitions) > 0
}

/*
 * TransactionIsOpen reports whether the cluster has still to finish it.
 *
 * Ongoing is the obvious one. The two prepare states count as well: the
 * coordinator has decided and is still writing markers, and a partition
 * without one is as unreadable as it was before. Everything else - the
 * complete states, and empty - is a transaction that has already ended, which
 * the cluster keeps listed for a while afterwards.
 */
func TransactionIsOpen(transaction *model.Transaction) bool {
	switch transaction.State {
	case txnOngoing, txnPrepareCommit, txnPrepareAbort:
		return true
	default:
		return false
	}
}
